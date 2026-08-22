import WebSocket, { type RawData } from "ws";

import {
  agentBootstrapSchema,
  commandStartAckSchema,
  commandEnvelopeSchema,
  retryDelayMs,
  type AgentBootstrap,
  type AgentMessage,
  type CommandEnvelope
} from "@discord-vc-control/contracts";
import {
  ReplayGuard,
  agentHandshakePayload,
  signAgentHandshake,
  verifyCommandEnvelope
} from "@discord-vc-control/security";

export interface AgentClientOptions {
  deploymentId: string;
  endpoint: string;
  keyId: string;
  onBlocked: (code: string) => Promise<void> | void;
  onBootstrap: (bootstrap: AgentBootstrap) => Promise<void> | void;
  onCommand: (command: CommandEnvelope, duplicate: boolean) => Promise<void> | void;
  previousKeyId?: string;
  previousSecret?: string;
  secret: string;
  tenantId: string;
}

export class AgentClient {
  readonly #acceptedCommands = new Map<string, { expiresAt: number; nonce: string }>();
  readonly #outbox: AgentMessage[] = [];
  readonly #pendingStarts = new Map<string, { command: CommandEnvelope; timer: NodeJS.Timeout }>();
  readonly #replayGuard = new ReplayGuard();
  #closed = false;
  #blocked = false;
  #messageQueue: Promise<void> = Promise.resolve();
  #retryCount = 0;
  #socket: WebSocket | null = null;
  #timer: NodeJS.Timeout | null = null;

  constructor(private readonly options: AgentClientOptions) {}

  get connected(): boolean {
    return this.#socket?.readyState === WebSocket.OPEN;
  }

  async start(): Promise<void> {
    this.#closed = false;
    this.#blocked = false;
    this.#retryCount = 0;
    await this.connect();
  }

  close(): void {
    this.#closed = true;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.clearPendingStarts();
    this.#socket?.close(1000, "agent shutdown");
    this.#socket = null;
  }

  send(message: AgentMessage): void {
    const socket = this.#socket;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return;
    }
    if (message.type !== "heartbeat") this.enqueue(message);
  }

  private async connect(): Promise<void> {
    if (this.#closed) return;
    const timestamp = Date.now();
    const nonce = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    const endpoint = new URL(this.options.endpoint);
    const payload = agentHandshakePayload({
      agentId: this.options.deploymentId,
      method: "GET",
      nonce,
      path: endpoint.pathname,
      timestamp
    });
    const signature = await signAgentHandshake(payload, this.options.secret);
    const socket = new WebSocket(this.options.endpoint, {
      headers: {
        "x-agent-id": this.options.deploymentId,
        "x-agent-key-id": this.options.keyId,
        "x-agent-nonce": nonce,
        "x-agent-signature": signature,
        "x-agent-timestamp": String(timestamp)
      },
      handshakeTimeout: 15_000,
      maxPayload: 128 * 1024,
      perMessageDeflate: false
    });
    this.#socket = socket;
    socket.once("open", () => {
      this.#retryCount = 0;
      for (const message of this.#outbox.splice(0)) socket.send(JSON.stringify(message));
    });
    socket.on("message", (data) => {
      this.#messageQueue = this.#messageQueue.then(() => this.handleMessage(data));
    });
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      if (response.statusCode === 401 || response.statusCode === 403) {
        this.block("AGENT_AUTH_REJECTED");
      }
    });
    socket.once("close", () => {
      this.clearPendingStarts();
      this.scheduleReconnect();
    });
    socket.once("error", () => {
      socket.close();
    });
  }

  private async handleMessage(data: RawData): Promise<void> {
    try {
      if (Array.isArray(data)) throw new Error("FRAGMENTED_COMMAND_REJECTED");
      const text = Buffer.isBuffer(data)
        ? data.toString("utf8")
        : Buffer.from(data).toString("utf8");
      const input: unknown = JSON.parse(text);
      const startAck = commandStartAckSchema.safeParse(input);
      if (startAck.success) {
        await this.handleCommandStartAck(startAck.data);
        return;
      }
      const bootstrap = agentBootstrapSchema.safeParse(input);
      if (bootstrap.success) {
        if (bootstrap.data.deployment_id !== this.options.deploymentId) {
          throw new Error("WRONG_BOOTSTRAP_DEPLOYMENT");
        }
        if (bootstrap.data.tenant_id !== this.options.tenantId) {
          throw new Error("WRONG_BOOTSTRAP_TENANT");
        }
        await this.options.onBootstrap(bootstrap.data);
        return;
      }
      const candidate = commandEnvelopeSchema.parse(input);
      const verified = await verifyCommandEnvelope(candidate, {
        secretsByKeyId: this.secretsByKeyId()
      });
      if (verified.deployment_id !== this.options.deploymentId) {
        throw new Error("WRONG_COMMAND_DEPLOYMENT");
      }
      if (verified.tenant_id !== this.options.tenantId) {
        throw new Error("WRONG_COMMAND_TENANT");
      }
      const existing = this.#acceptedCommands.get(verified.command_id);
      if (existing !== undefined) {
        if (existing.nonce !== verified.nonce) throw new Error("COMMAND_ID_COLLISION");
        await this.options.onCommand(verified, true);
        return;
      }
      const pending = this.#pendingStarts.get(verified.command_id);
      if (pending !== undefined) {
        if (pending.command.nonce !== verified.nonce) throw new Error("COMMAND_ID_COLLISION");
        return;
      }
      if (
        [...this.#pendingStarts.values()].some(
          (candidate) => candidate.command.nonce === verified.nonce
        )
      ) {
        throw new Error("COMMAND_REPLAY");
      }
      const timer = setTimeout(() => {
        this.#pendingStarts.delete(verified.command_id);
        this.#socket?.close(1011, "command start acknowledgement timeout");
      }, 5_000);
      this.#pendingStarts.set(verified.command_id, { command: verified, timer });
      this.send({
        type: "command_start",
        command_id: verified.command_id,
        deployment_id: this.options.deploymentId,
        occurred_at: Date.now()
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "INVALID_CONTROL_MESSAGE";
      const code = /^[A-Z\d_]{1,64}$/u.test(message) ? message : "INVALID_CONTROL_MESSAGE";
      this.rejectControlMessage(code);
    }
  }

  private scheduleReconnect(): void {
    this.#socket = null;
    if (this.#closed || this.#blocked || this.#timer !== null) return;
    this.#retryCount += 1;
    if (this.#retryCount > 5) {
      this.block("AGENT_RECONNECT_LIMIT");
      return;
    }
    const delay = retryDelayMs(this.#retryCount);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.connect().catch(() => this.scheduleReconnect());
    }, delay);
  }

  private block(code: string): void {
    if (this.#blocked) return;
    this.#blocked = true;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.clearPendingStarts();
    this.#socket?.terminate();
    this.#socket = null;
    void this.options.onBlocked(code);
  }

  private rejectControlMessage(code: string): void {
    if (this.#blocked) return;
    this.#blocked = true;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.clearPendingStarts();
    const socket = this.#socket;
    this.#socket = null;
    socket?.close(1008, "invalid control message");
    void this.options.onBlocked(code);
  }

  private enqueue(message: AgentMessage): void {
    const replacementKey = this.replacementKey(message);
    if (replacementKey !== null) {
      const existing = this.#outbox.findIndex(
        (candidate) => this.replacementKey(candidate) === replacementKey
      );
      if (existing >= 0) this.#outbox.splice(existing, 1);
    }
    this.#outbox.push(message);
    while (this.#outbox.length > 1_000) {
      const replaceable = this.#outbox.findIndex(
        (candidate) => this.replacementKey(candidate) !== null
      );
      this.#outbox.splice(replaceable >= 0 ? replaceable : 0, 1);
    }
  }

  private async handleCommandStartAck(
    acknowledgement: ReturnType<typeof commandStartAckSchema.parse>
  ): Promise<void> {
    if (acknowledgement.deployment_id !== this.options.deploymentId) {
      throw new Error("WRONG_COMMAND_START_DEPLOYMENT");
    }
    const pending = this.#pendingStarts.get(acknowledgement.command_id);
    if (pending === undefined) {
      if (acknowledgement.duplicate) return;
      throw new Error("UNEXPECTED_COMMAND_START_ACK");
    }
    clearTimeout(pending.timer);
    this.#pendingStarts.delete(acknowledgement.command_id);
    if (!acknowledgement.accepted) {
      if (acknowledgement.duplicate) return;
      throw new Error("COMMAND_START_REJECTED");
    }
    if (acknowledgement.duplicate) throw new Error("INVALID_COMMAND_START_ACK");
    if (!this.#replayGuard.accept(pending.command.nonce)) throw new Error("COMMAND_REPLAY");
    const now = Date.now();
    for (const [commandId, receipt] of this.#acceptedCommands) {
      if (receipt.expiresAt <= now) this.#acceptedCommands.delete(commandId);
    }
    this.#acceptedCommands.set(pending.command.command_id, {
      expiresAt: now + 24 * 60 * 60_000,
      nonce: pending.command.nonce
    });
    await this.options.onCommand(pending.command, false);
  }

  private clearPendingStarts(): void {
    for (const pending of this.#pendingStarts.values()) clearTimeout(pending.timer);
    this.#pendingStarts.clear();
  }

  private replacementKey(message: AgentMessage): string | null {
    if (message.type === "status") return "status";
    if (message.type === "guild_config_event") return `guild:${message.config.guild_id}`;
    if (message.type === "authorized_target_event") return "authorized-target";
    if (message.type === "managed_room_event") {
      const channelId =
        message.operation === "upsert" ? message.room.channel_id : message.channel_id;
      return `room:${channelId}`;
    }
    return null;
  }

  private secretsByKeyId(): ReadonlyMap<string, string> {
    const secrets = new Map([[this.options.keyId, this.options.secret]]);
    if (this.options.previousKeyId && this.options.previousSecret) {
      secrets.set(this.options.previousKeyId, this.options.previousSecret);
    }
    return secrets;
  }
}
