import {
  parseActionPayload,
  transitionVoiceMachine,
  type AgentStatus,
  type AuthorizedTarget,
  type CommandAck,
  type CommandEnvelope,
  type VoiceMachineEvent,
  type VoiceMachineSnapshot
} from "@discord-vc-control/contracts";
import { FixedWindowRateLimiter, sanitizeRelayText } from "@discord-vc-control/security";

import {
  type DiscordRpcSession,
  type RpcChannel,
  type VoiceSelection
} from "./discord-rpc-session.js";
import { type DraftHandoff } from "./draft-handoff.js";

export interface UserRpcControllerOptions {
  allowedGuildId: string;
  deploymentId: string;
  draftHandoff: DraftHandoff;
  onStatus: (status: AgentStatus) => void;
  rpc: Pick<
    DiscordRpcSession,
    | "authenticate"
    | "close"
    | "connect"
    | "getSelectedVoiceChannel"
    | "onDisconnect"
    | "selectTextChannel"
    | "selectVoiceChannel"
    | "subscribeVoiceSelection"
  >;
}

export class UserRpcController {
  readonly #deploymentDraftLimiter = new FixedWindowRateLimiter(20, 60_000);
  readonly #operatorDraftLimiter = new FixedWindowRateLimiter(5, 60_000);
  #lastErrorCode: string | null = null;
  #machine: VoiceMachineSnapshot = {
    state: "DISABLED",
    desiredConnected: false,
    retryCount: 0,
    circuitOpen: false,
    reason: "not_started"
  };
  #rpcConnected = false;
  #selectedChannel: RpcChannel | null = null;
  #target: AuthorizedTarget | null = null;
  #unsubscribeSelection: (() => void) | null = null;
  #unsubscribeDisconnect: (() => void) | null = null;

  constructor(private readonly options: UserRpcControllerOptions) {}

  get status(): AgentStatus {
    const targetSelected =
      this.#selectedChannel?.id === this.#target?.voice_channel_id &&
      this.#selectedChannel?.guild_id === this.#target?.guild_id;
    return {
      type: "status",
      deployment_id: this.options.deploymentId,
      agent_kind: "authorized_local_rpc",
      local_rpc_connected: this.#rpcConnected,
      desired_connected: this.#machine.desiredConnected,
      observed_state: this.#machine.state,
      gateway_connected: false,
      voice_connected: targetSelected,
      udp_established: false,
      dave_established: false,
      target_guild_id: this.#target?.guild_id ?? null,
      target_channel_id: this.#target?.voice_channel_id ?? null,
      circuit_open: this.#machine.circuitOpen,
      retry_count: this.#machine.retryCount,
      last_error_code: this.#lastErrorCode,
      last_health_at: Date.now()
    };
  }

  async initialize(accessToken: string, expectedUserId: string): Promise<void> {
    this.transition({ type: "START" });
    await this.options.rpc.connect();
    const authenticated = await this.options.rpc.authenticate(accessToken);
    if (authenticated.userId !== expectedUserId) {
      this.options.rpc.close();
      this.block("RPC_AUTHORIZED_USER_MISMATCH", "AUTH_FAILURE");
      throw new Error("RPC_AUTHORIZED_USER_MISMATCH");
    }
    if (!authenticated.scopes.includes("rpc")) {
      this.options.rpc.close();
      this.block("RPC_SCOPE_MISSING", "AUTH_FAILURE");
      throw new Error("RPC_SCOPE_MISSING");
    }
    this.#rpcConnected = true;
    this.#selectedChannel = await this.options.rpc.getSelectedVoiceChannel();
    this.#unsubscribeSelection = await this.options.rpc.subscribeVoiceSelection((selection) =>
      this.handleVoiceSelection(selection)
    );
    this.#unsubscribeDisconnect = this.options.rpc.onDisconnect((code) =>
      this.handleRpcDisconnect(code)
    );
    this.#machine = {
      state: "DISABLED",
      desiredConnected: false,
      retryCount: 0,
      circuitOpen: false,
      reason: "rpc_authenticated"
    };
    this.publishStatus();
  }

  async setTarget(target: AuthorizedTarget | null): Promise<void> {
    if (target !== null && target.guild_id !== this.options.allowedGuildId) {
      this.block("RPC_TARGET_GUILD_NOT_ALLOWED", "AUTH_FAILURE");
      throw new Error("RPC_TARGET_GUILD_NOT_ALLOWED");
    }
    const changed =
      this.#target?.guild_id !== target?.guild_id ||
      this.#target?.voice_channel_id !== target?.voice_channel_id ||
      this.#target?.text_channel_id !== target?.text_channel_id;
    const oldTargetSelected = this.isTargetSelected();
    this.#target = target;
    if (changed && this.#machine.desiredConnected) {
      this.block("RPC_TARGET_AUTHORIZATION_CHANGED", "AUTH_FAILURE");
      if (oldTargetSelected) await this.leaveSelectedChannel().catch(() => undefined);
    }
    this.publishStatus();
  }

  async applyDesiredState(desiredConnected: boolean, paused: boolean): Promise<void> {
    if (paused) {
      this.#machine = {
        ...this.#machine,
        state: "PAUSED",
        desiredConnected,
        circuitOpen: false,
        reason: "bootstrap_pause"
      };
      if (this.isTargetSelected()) await this.leaveSelectedChannel();
      this.publishStatus();
      return;
    }
    if (desiredConnected) {
      await this.connectToTarget("bootstrap_desired_state");
      return;
    }
    this.#machine = transitionVoiceMachine(this.#machine, { type: "LEAVE" });
    if (this.isTargetSelected()) await this.leaveSelectedChannel();
    this.publishStatus();
  }

  async execute(command: CommandEnvelope): Promise<CommandAck> {
    try {
      let resultCode = "OK";
      let summary: string;
      switch (command.action) {
        case "status":
          summary = this.statusSummary();
          break;
        case "diagnostics":
          summary = this.diagnosticsSummary();
          break;
        case "join":
          await this.connectToTarget("operator_join");
          summary = "The authorized local Discord user joined the exact voice target.";
          break;
        case "leave":
          this.#machine = transitionVoiceMachine(this.#machine, { type: "LEAVE" });
          if (this.isTargetSelected()) await this.leaveSelectedChannel();
          summary = "The authorized local Discord user left the voice target.";
          break;
        case "reconnect":
          this.#machine = transitionVoiceMachine(this.#machine, { type: "LEAVE" });
          if (this.isTargetSelected()) await this.leaveSelectedChannel();
          await this.connectToTarget("operator_reconnect");
          summary = "The authorized local Discord user rejoined the exact voice target.";
          break;
        case "pause":
          this.#machine = transitionVoiceMachine(this.#machine, { type: "PAUSE" });
          if (this.isTargetSelected()) await this.leaveSelectedChannel();
          summary = "Local RPC voice control is paused.";
          break;
        case "resume":
          this.#machine = transitionVoiceMachine(this.#machine, { type: "RESUME" });
          await this.establishTargetSelection();
          summary = "Local RPC voice control resumed at the exact voice target.";
          break;
        case "relay":
          await this.stageDraft(command);
          resultCode = "USER_SEND_REQUIRED";
          summary =
            "Draft copied locally and the authorized text channel selected; no message was sent.";
          break;
        case "audit":
          throw new Error("AUDIT_HANDLED_BY_CONTROL_PLANE");
      }
      return {
        type: "ack",
        command_id: command.command_id,
        accepted: true,
        duplicate: false,
        result_code: resultCode,
        summary,
        observed_state: this.#machine.state,
        occurred_at: Date.now()
      };
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 64) : "COMMAND_FAILED";
      this.#lastErrorCode = code;
      this.publishStatus();
      return {
        type: "ack",
        command_id: command.command_id,
        accepted: false,
        duplicate: false,
        result_code: code,
        summary: this.publicError(code),
        observed_state: this.#machine.state,
        occurred_at: Date.now()
      };
    }
  }

  handleControlPlaneFailure(code: string): void {
    this.block(code, "AUTH_FAILURE");
  }

  async shutdown(): Promise<void> {
    this.#machine = transitionVoiceMachine(this.#machine, { type: "SHUTDOWN" });
    this.#unsubscribeSelection?.();
    this.#unsubscribeSelection = null;
    this.#unsubscribeDisconnect?.();
    this.#unsubscribeDisconnect = null;
    if (this.isTargetSelected()) await this.leaveSelectedChannel().catch(() => undefined);
    this.options.rpc.close();
    this.#rpcConnected = false;
    this.publishStatus();
  }

  private async connectToTarget(reason: string): Promise<void> {
    if (!this.#rpcConnected) throw new Error("DISCORD_RPC_NOT_CONNECTED");
    this.#lastErrorCode = null;
    this.#machine = transitionVoiceMachine(this.#machine, { type: "CONNECT_REQUEST" });
    this.#machine.reason = reason;
    await this.establishTargetSelection();
  }

  private async establishTargetSelection(): Promise<void> {
    const target = this.requireTarget();
    const current = await this.options.rpc.getSelectedVoiceChannel();
    this.#selectedChannel = current;
    if (
      current !== null &&
      (current.id !== target.voice_channel_id || current.guild_id !== target.guild_id)
    ) {
      this.block("RPC_USER_ALREADY_IN_DIFFERENT_VOICE", "MODERATOR_MOVE");
      throw new Error("RPC_USER_ALREADY_IN_DIFFERENT_VOICE");
    }
    const selected =
      current ??
      (await this.options.rpc.selectVoiceChannel(target.voice_channel_id, { navigate: false }));
    if (
      selected?.id !== target.voice_channel_id ||
      selected.guild_id !== target.guild_id ||
      selected.type !== 2
    ) {
      this.block("RPC_VOICE_SELECTION_MISMATCH", "AUTH_FAILURE");
      throw new Error("RPC_VOICE_SELECTION_MISMATCH");
    }
    this.#selectedChannel = selected;
    this.#machine = transitionVoiceMachine(this.#machine, { type: "CONNECTED" });
    this.publishStatus();
  }

  private async leaveSelectedChannel(): Promise<void> {
    await this.options.rpc.selectVoiceChannel(null, { navigate: false });
    this.#selectedChannel = null;
  }

  private async stageDraft(command: CommandEnvelope): Promise<void> {
    const target = this.requireTarget();
    if (!this.isTargetSelected()) throw new Error("RPC_VOICE_NOT_CONNECTED");
    if (!this.#operatorDraftLimiter.consume(command.actor_user_id)) {
      throw new Error("OPERATOR_DRAFT_RATE_LIMIT");
    }
    if (!this.#deploymentDraftLimiter.consume(this.options.deploymentId)) {
      throw new Error("DEPLOYMENT_DRAFT_RATE_LIMIT");
    }
    const payload = parseActionPayload("relay", command.payload);
    const text = sanitizeRelayText(payload.text, {
      maxLength: 1_000,
      rejectedPrefixes: ["!voice", "!v"]
    });
    const selected = await this.options.rpc.selectTextChannel(target.text_channel_id);
    if (selected?.id !== target.text_channel_id || selected.guild_id !== target.guild_id) {
      throw new Error("RPC_TEXT_SELECTION_MISMATCH");
    }
    await this.options.draftHandoff.stage(text);
  }

  private handleVoiceSelection(selection: VoiceSelection): void {
    const wasDesired = this.#machine.desiredConnected;
    if (selection.channel_id === null || selection.guild_id === null) {
      this.#selectedChannel = null;
      if (wasDesired && this.#machine.state !== "PAUSED") {
        this.block("RPC_UNEXPECTED_VOICE_DISCONNECT", "MODERATOR_DISCONNECT");
      } else {
        this.publishStatus();
      }
      return;
    }
    this.#selectedChannel = {
      id: selection.channel_id,
      guild_id: selection.guild_id,
      name: "selected",
      type: 2
    };
    if (
      wasDesired &&
      (selection.channel_id !== this.#target?.voice_channel_id ||
        selection.guild_id !== this.#target?.guild_id)
    ) {
      this.block("RPC_UNEXPECTED_VOICE_MOVE", "MODERATOR_MOVE");
    } else {
      this.publishStatus();
    }
  }

  private handleRpcDisconnect(code: string): void {
    this.#rpcConnected = false;
    this.#selectedChannel = null;
    if (this.#machine.state === "SHUTTING_DOWN" || this.#machine.state === "DISABLED") {
      this.publishStatus();
      return;
    }
    this.block(code, "AUTH_FAILURE");
  }

  private requireTarget(): AuthorizedTarget {
    if (this.#target === null) throw new Error("AUTHORIZED_TARGET_NOT_SET");
    return this.#target;
  }

  private isTargetSelected(): boolean {
    return (
      this.#selectedChannel?.id === this.#target?.voice_channel_id &&
      this.#selectedChannel?.guild_id === this.#target?.guild_id
    );
  }

  private block(
    code: string,
    event: Extract<
      VoiceMachineEvent["type"],
      "AUTH_FAILURE" | "MODERATOR_DISCONNECT" | "MODERATOR_MOVE"
    >
  ): void {
    this.#lastErrorCode = code;
    this.#machine = transitionVoiceMachine(this.#machine, { type: event });
    this.publishStatus();
  }

  private transition(event: VoiceMachineEvent): void {
    this.#machine = transitionVoiceMachine(this.#machine, event);
    this.publishStatus();
  }

  private publishStatus(): void {
    this.options.onStatus(this.status);
  }

  private statusSummary(): string {
    return `${this.#machine.state}; local_rpc=${this.#rpcConnected ? "connected" : "disconnected"}; voice=${this.isTargetSelected() ? "connected" : "disconnected"}; account=${this.#rpcConnected ? "bound" : "unavailable"}`;
  }

  private diagnosticsSummary(): string {
    return `state=${this.#machine.state}; adapter=authorized_local_rpc; local_rpc=${this.#rpcConnected}; voice=${this.isTargetSelected()}; gateway=not_owned; udp=not_observable; dave=not_observable; retries=${this.#machine.retryCount}; last_error=${this.#lastErrorCode ?? "none"}`;
  }

  private publicError(code: string): string {
    const messages: Record<string, string> = {
      AUTHORIZED_TARGET_NOT_SET: "No exact target has been authorized.",
      DISCORD_RPC_NOT_CONNECTED: "The authorized local Discord desktop session is unavailable.",
      RPC_USER_ALREADY_IN_DIFFERENT_VOICE:
        "The authorized user is already in another voice channel; no forced move was attempted.",
      RPC_VOICE_NOT_CONNECTED:
        "The authorized local user is not connected to the exact voice target.",
      RPC_TARGET_GUILD_NOT_ALLOWED: "The target is outside this local profile's allowed server.",
      OPERATOR_DRAFT_RATE_LIMIT: "This operator reached the local draft limit.",
      DEPLOYMENT_DRAFT_RATE_LIMIT: "This deployment reached the local draft limit."
    };
    return messages[code] ?? `Command rejected: ${code}.`;
  }
}
