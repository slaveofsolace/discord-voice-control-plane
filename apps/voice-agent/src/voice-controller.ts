import {
  VoiceConnectionDisconnectReason,
  VoiceConnectionStatus,
  entersState,
  joinVoiceChannel,
  type VoiceConnection,
  type VoiceConnectionState
} from "@discordjs/voice";
import { ChannelType, PermissionFlagsBits, type Client, type VoiceState } from "discord.js";

import {
  parseActionPayload,
  transitionVoiceMachine,
  retryDelayMs,
  type AgentStatus,
  type AuthorizedTarget,
  type CommandAck,
  type CommandEnvelope,
  type VoiceMachineEvent,
  type VoiceMachineSnapshot
} from "@discord-vc-control/contracts";
import { FixedWindowRateLimiter, sanitizeRelayText } from "@discord-vc-control/security";

export interface VoiceControllerOptions {
  client: Client;
  deploymentId: string;
  onStatus: (status: AgentStatus) => void;
}

const maximumTransientRetries = 5;
const daveNegotiationTimeoutMs = 5_000;
const voiceStateDisconnectTimeoutMs = 2_000;

interface ExpectedDisconnect {
  channelId: string;
  finish: () => void;
}

export class VoiceController {
  readonly #deploymentRelayLimiter = new FixedWindowRateLimiter(20, 60_000);
  readonly #operatorRelayLimiter = new FixedWindowRateLimiter(5, 60_000);
  #connectionAttempt = 0;
  #connection: VoiceConnection | null = null;
  #daveEstablished = false;
  #expectedDisconnect: ExpectedDisconnect | null = null;
  #lastErrorCode: string | null = null;
  #machine: VoiceMachineSnapshot = {
    state: "DISABLED",
    desiredConnected: false,
    retryCount: 0,
    circuitOpen: false,
    reason: "not_started"
  };
  #retryTimer: NodeJS.Timeout | null = null;
  #target: AuthorizedTarget | null = null;

  constructor(private readonly options: VoiceControllerOptions) {}

  start(): void {
    this.transition({ type: "START" });
  }

  get status(): AgentStatus {
    const ready = this.#connection?.state.status === VoiceConnectionStatus.Ready;
    return {
      type: "status",
      deployment_id: this.options.deploymentId,
      desired_connected: this.#machine.desiredConnected,
      observed_state: this.#machine.state,
      gateway_connected: this.options.client.isReady(),
      voice_connected: ready,
      udp_established: ready,
      dave_established: ready && this.#daveEstablished,
      target_guild_id: this.#target?.guild_id ?? null,
      target_channel_id: this.#target?.voice_channel_id ?? null,
      circuit_open: this.#machine.circuitOpen,
      retry_count: this.#machine.retryCount,
      last_error_code: this.#lastErrorCode,
      last_health_at: Date.now()
    };
  }

  setTarget(target: AuthorizedTarget | null): void {
    const changed =
      this.#target?.guild_id !== target?.guild_id ||
      this.#target?.voice_channel_id !== target?.voice_channel_id;
    if (changed) this.invalidateConnectionAttempt();
    this.#target = target;
    if (changed && this.#connection !== null) this.block("AUTHORIZATION_CHANGED", "AUTH_FAILURE");
    this.publishStatus();
  }

  async applyDesiredState(desiredConnected: boolean, paused: boolean): Promise<void> {
    if (paused) {
      this.invalidateConnectionAttempt();
      this.#machine = {
        ...this.#machine,
        state: "PAUSED",
        desiredConnected,
        circuitOpen: false,
        reason: "bootstrap_pause"
      };
      this.destroyConnection();
      this.publishStatus();
      return;
    }
    if (desiredConnected) {
      await this.connect("bootstrap_desired_state");
      return;
    }
    this.transition({ type: "LEAVE" });
    this.#machine.reason = "bootstrap_disabled";
    this.invalidateConnectionAttempt();
    this.destroyConnection();
  }

  async execute(command: CommandEnvelope): Promise<CommandAck> {
    let summary = "Command completed.";
    let targetMessageId: string | undefined;
    try {
      switch (command.action) {
        case "status":
          summary = this.statusSummary();
          break;
        case "diagnostics":
          summary = this.diagnosticsSummary();
          break;
        case "join":
          await this.connect("operator_join");
          summary = "Joined the authorized voice channel silently.";
          break;
        case "leave":
          this.transition({ type: "LEAVE" });
          this.invalidateConnectionAttempt();
          this.destroyConnection();
          summary = "Left the authorized voice channel.";
          break;
        case "reconnect":
          this.invalidateConnectionAttempt();
          await this.disconnectForReconnect();
          await this.connect("operator_reconnect");
          summary = "Reconnected to the authorized voice channel.";
          break;
        case "pause":
          this.transition({ type: "PAUSE" });
          this.invalidateConnectionAttempt();
          this.destroyConnection();
          summary = "Voice connection paused.";
          break;
        case "resume":
          this.transition({ type: "RESUME" });
          await this.establishConnection();
          summary = "Voice connection resumed.";
          break;
        case "relay": {
          const payload = parseActionPayload("relay", command.payload);
          targetMessageId = await this.relay(
            command.actor_user_id,
            payload.text,
            command.command_id
          );
          summary = "Relayed one plain-text message to the authorized channel.";
          break;
        }
        case "audit":
          throw new Error("AUDIT_HANDLED_BY_CONTROL_PLANE");
      }
      return {
        type: "ack",
        command_id: command.command_id,
        accepted: true,
        duplicate: false,
        result_code: "OK",
        summary,
        ...(targetMessageId === undefined ? {} : { target_message_id: targetMessageId }),
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

  handleOwnVoiceState(oldState: VoiceState, newState: VoiceState): void {
    const targetChannelId = this.#target?.voice_channel_id;
    if (targetChannelId === undefined || oldState.channelId !== targetChannelId) return;
    if (newState.channelId === null && this.#expectedDisconnect?.channelId === targetChannelId) {
      this.#expectedDisconnect.finish();
      return;
    }
    if (
      !this.#machine.desiredConnected ||
      this.#machine.state === "PAUSED" ||
      this.#machine.state === "DISABLED" ||
      this.#machine.state === "SHUTTING_DOWN"
    ) {
      return;
    }
    if (newState.channelId === null) {
      this.block("MODERATOR_DISCONNECT", "MODERATOR_DISCONNECT");
    } else if (newState.channelId !== targetChannelId) {
      this.block("MODERATOR_MOVE", "MODERATOR_MOVE");
    }
  }

  handleChannelDelete(channelId: string): void {
    if (channelId === this.#target?.voice_channel_id)
      this.block("TARGET_CHANNEL_DELETED", "CHANNEL_DELETED");
  }

  handleControlPlaneFailure(code: string): void {
    this.block(code, "AUTH_FAILURE");
  }

  shutdown(): void {
    this.transition({ type: "SHUTDOWN" });
    this.invalidateConnectionAttempt();
    this.destroyConnection();
  }

  private async connect(reason: string): Promise<void> {
    if (this.#connection?.state.status === VoiceConnectionStatus.Ready && this.#daveEstablished) {
      this.transition({ type: "CONNECTED" });
      return;
    }
    this.#lastErrorCode = null;
    this.transition({ type: "CONNECT_REQUEST" });
    this.#machine.reason = reason;
    await this.establishConnection();
  }

  private async establishConnection(): Promise<void> {
    const attempt = ++this.#connectionAttempt;
    const target = this.#target;
    if (target === null) {
      this.block("AUTHORIZED_TARGET_NOT_SET", "AUTH_FAILURE");
      throw new Error("AUTHORIZED_TARGET_NOT_SET");
    }
    if (!this.options.client.isReady()) {
      this.handleTransientFailure("DISCORD_GATEWAY_NOT_READY");
      throw new Error("DISCORD_GATEWAY_NOT_READY");
    }
    const guild = await this.options.client.guilds.fetch(target.guild_id).catch(() => null);
    this.assertConnectionAttempt(attempt, target);
    if (guild === null) {
      this.block("AUTHORIZED_GUILD_UNAVAILABLE", "AUTH_FAILURE");
      throw new Error("AUTHORIZED_GUILD_UNAVAILABLE");
    }
    const channel = await guild.channels.fetch(target.voice_channel_id).catch(() => null);
    this.assertConnectionAttempt(attempt, target);
    if (channel === null) {
      this.block("TARGET_CHANNEL_DELETED", "CHANNEL_DELETED");
      throw new Error("TARGET_CHANNEL_DELETED");
    }
    if (channel.type !== ChannelType.GuildVoice) {
      this.block("AUTHORIZED_TARGET_NOT_VOICE", "AUTH_FAILURE");
      throw new Error("AUTHORIZED_TARGET_NOT_VOICE");
    }
    const me = guild.members.me ?? (await guild.members.fetchMe());
    this.assertConnectionAttempt(attempt, target);
    const permissions = channel.permissionsFor(me);
    if (
      !permissions.has(PermissionFlagsBits.ViewChannel) ||
      !permissions.has(PermissionFlagsBits.Connect)
    ) {
      this.block("VOICE_PERMISSION_LOST", "PERMISSION_LOST");
      throw new Error("VOICE_PERMISSION_LOST");
    }
    this.cancelRetry();
    if (this.#connection !== null) await this.disconnectForReconnect();
    this.assertConnectionAttempt(attempt, target);
    this.#daveEstablished = false;
    const connection = joinVoiceChannel({
      adapterCreator: guild.voiceAdapterCreator,
      channelId: channel.id,
      daveEncryption: true,
      guildId: guild.id,
      group: this.options.deploymentId,
      selfDeaf: true,
      selfMute: true
    });
    try {
      this.assertConnectionAttempt(attempt, target);
    } catch (error) {
      connection.destroy();
      throw error;
    }
    this.#connection = connection;
    connection.on("transitioned", () => {
      if (this.#connection !== connection) return;
      this.#daveEstablished = true;
      if (connection.state.status === VoiceConnectionStatus.Ready) {
        this.transition({ type: "CONNECTED" });
      } else {
        this.publishStatus();
      }
    });
    connection.on("error", (error) => this.handleConnectionError(connection, error));
    connection.on("stateChange", (oldState, newState) =>
      this.handleConnectionState(connection, oldState, newState)
    );
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
      this.assertConnectionAttempt(attempt, target);
      if (this.#connection !== connection) throw new Error("VOICE_CONNECTION_SUPERSEDED");
      this.#daveEstablished = this.#daveEstablished || connection.voicePrivacyCode !== undefined;
      if (!this.#daveEstablished) await this.waitForDave(connection);
      this.transition({ type: "CONNECTED" });
    } catch (error) {
      if (error instanceof Error && error.message === "VOICE_CONNECTION_SUPERSEDED") {
        if (this.#connection === connection) this.#connection = null;
        if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
        throw error;
      }
      if (
        this.#connection === connection &&
        (this.#machine.state === "CONNECTING" || this.#machine.state === "DEGRADED")
      ) {
        this.handleTransientFailure("VOICE_CONNECT_TIMEOUT");
      }
      throw error instanceof Error ? error : new Error("VOICE_CONNECT_FAILED");
    }
  }

  private handleConnectionState(
    connection: VoiceConnection,
    _oldState: VoiceConnectionState,
    newState: VoiceConnectionState
  ): void {
    if (this.#connection !== connection) return;
    if (newState.status === VoiceConnectionStatus.Ready) {
      this.#daveEstablished =
        this.#daveEstablished || this.#connection?.voicePrivacyCode !== undefined;
      this.transition({ type: this.#daveEstablished ? "CONNECTED" : "DAVE_PENDING" });
      return;
    }
    if (newState.status !== VoiceConnectionStatus.Disconnected) return;
    if (
      newState.reason === VoiceConnectionDisconnectReason.WebSocketClose &&
      newState.closeCode === 4014
    ) {
      this.block("VOICE_CLOSE_4014", "MODERATOR_DISCONNECT");
      return;
    }
    this.handleTransientFailure("VOICE_TRANSPORT_DISCONNECTED");
  }

  private handleConnectionError(connection: VoiceConnection, error: Error): void {
    if (this.#connection !== connection) return;
    const normalized = error.message.toUpperCase();
    if (
      normalized.includes("DAVE") ||
      normalized.includes("MLS") ||
      normalized.includes("DECRYPT")
    ) {
      if (this.#machine.retryCount >= 1) {
        this.block("DAVE_NEGOTIATION_FAILED", "PROTOCOL_FAILURE");
        return;
      }
      this.handleTransientFailure("DAVE_TRANSIENT_FAILURE");
      return;
    }
    this.handleTransientFailure("VOICE_CONNECTION_ERROR");
  }

  private async waitForDave(connection: VoiceConnection): Promise<void> {
    if (this.#daveEstablished || connection.voicePrivacyCode !== undefined) {
      this.#daveEstablished = true;
      return;
    }
    this.transition({ type: "DAVE_PENDING" });
    const established = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (value: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        connection.off("transitioned", transitioned);
        resolve(value);
      };
      const transitioned = (): void => finish(true);
      const timer = setTimeout(() => finish(false), daveNegotiationTimeoutMs);
      connection.once("transitioned", transitioned);
    });
    if (established && this.#connection === connection) {
      this.#daveEstablished = true;
      return;
    }
    if (
      this.#connection !== connection ||
      !this.#machine.desiredConnected ||
      this.#machine.state === "PAUSED" ||
      this.#machine.state === "DISABLED" ||
      this.#machine.state === "SHUTTING_DOWN"
    ) {
      throw new Error("VOICE_CONNECTION_SUPERSEDED");
    }
    if (this.#machine.retryCount >= 1) {
      this.block("DAVE_NEGOTIATION_FAILED", "PROTOCOL_FAILURE");
    } else {
      this.handleTransientFailure("DAVE_NEGOTIATION_TIMEOUT");
    }
    throw new Error("DAVE_NEGOTIATION_TIMEOUT");
  }

  private handleTransientFailure(reason: string): void {
    if (
      !this.#machine.desiredConnected ||
      this.#machine.state === "PAUSED" ||
      this.#machine.state === "BLOCKED"
    ) {
      return;
    }
    this.#lastErrorCode = reason;
    this.transition({ type: "TRANSIENT_DISCONNECT", reason });
    if (this.#machine.retryCount > maximumTransientRetries) {
      this.block("MAX_TRANSIENT_RETRIES", "MAX_RETRIES");
      return;
    }
    this.cancelRetry();
    const delay = retryDelayMs(this.#machine.retryCount);
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      this.transition({ type: "RETRY_TIMER" });
      void this.establishConnection().catch(() => undefined);
    }, delay);
  }

  private block(
    code: string,
    eventType: Extract<
      VoiceMachineEvent["type"],
      | "MODERATOR_DISCONNECT"
      | "MODERATOR_MOVE"
      | "PERMISSION_LOST"
      | "CHANNEL_DELETED"
      | "AUTH_FAILURE"
      | "PROTOCOL_FAILURE"
      | "MAX_RETRIES"
    >
  ): void {
    this.invalidateConnectionAttempt();
    this.#lastErrorCode = code;
    this.transition({ type: eventType });
    this.destroyConnection();
  }

  private async relay(actorUserId: string, input: string, commandId: string): Promise<string> {
    const target = this.#target;
    if (target === null) throw new Error("AUTHORIZED_TARGET_NOT_SET");
    if (this.#machine.state !== "CONNECTED") throw new Error("VOICE_NOT_CONNECTED");
    if (!this.#operatorRelayLimiter.consume(actorUserId))
      throw new Error("OPERATOR_RELAY_RATE_LIMIT");
    if (!this.#deploymentRelayLimiter.consume(this.options.deploymentId)) {
      throw new Error("DEPLOYMENT_RELAY_RATE_LIMIT");
    }
    const text = sanitizeRelayText(input, { maxLength: 1000, rejectedPrefixes: ["!voice", "!v"] });
    const guild = await this.options.client.guilds.fetch(target.guild_id);
    const channel = await guild.channels.fetch(target.text_channel_id);
    if (!channel?.isTextBased()) throw new Error("AUTHORIZED_TEXT_TARGET_INVALID");
    const message = await channel.send({
      content: text,
      allowedMentions: { parse: [] },
      nonce: commandId.replaceAll("-", "").slice(0, 25),
      enforceNonce: true
    });
    return message.id;
  }

  private transition(event: VoiceMachineEvent): void {
    this.#machine = transitionVoiceMachine(this.#machine, event);
    this.publishStatus();
  }

  private destroyConnection(): void {
    this.cancelRetry();
    this.#expectedDisconnect?.finish();
    const connection = this.#connection;
    this.#connection = null;
    this.#daveEstablished = false;
    if (connection !== null && connection.state.status !== VoiceConnectionStatus.Destroyed) {
      connection.destroy();
    }
  }

  private async disconnectForReconnect(): Promise<void> {
    this.cancelRetry();
    this.#expectedDisconnect?.finish();
    const connection = this.#connection;
    this.#connection = null;
    this.#daveEstablished = false;
    if (connection === null || connection.state.status === VoiceConnectionStatus.Destroyed) return;
    const targetChannelId = this.#target?.voice_channel_id;
    if (targetChannelId === undefined) {
      connection.destroy();
      return;
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.#expectedDisconnect?.finish === finish) this.#expectedDisconnect = null;
        resolve();
      };
      const timer = setTimeout(finish, voiceStateDisconnectTimeoutMs);
      this.#expectedDisconnect = { channelId: targetChannelId, finish };
      connection.destroy();
    });
  }

  private cancelRetry(): void {
    if (this.#retryTimer !== null) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
  }

  private invalidateConnectionAttempt(): void {
    this.#connectionAttempt += 1;
  }

  private assertConnectionAttempt(attempt: number, target: AuthorizedTarget): void {
    if (
      attempt !== this.#connectionAttempt ||
      !this.#machine.desiredConnected ||
      this.#machine.state === "PAUSED" ||
      this.#machine.state === "BLOCKED" ||
      this.#machine.state === "DISABLED" ||
      this.#machine.state === "SHUTTING_DOWN" ||
      this.#target?.guild_id !== target.guild_id ||
      this.#target.voice_channel_id !== target.voice_channel_id
    ) {
      throw new Error("VOICE_CONNECTION_SUPERSEDED");
    }
  }

  private publishStatus(): void {
    this.options.onStatus(this.status);
  }

  private statusSummary(): string {
    const status = this.status;
    return `${status.observed_state}; voice=${status.voice_connected ? "connected" : "disconnected"}; DAVE=${status.dave_established ? "negotiated" : "not observed"}`;
  }

  private diagnosticsSummary(): string {
    const status = this.status;
    const ping = this.#connection?.ping;
    return `state=${status.observed_state}; gateway=${status.gateway_connected}; voice=${status.voice_connected}; udp=${status.udp_established}; dave=${status.dave_established}; ws_ping_ms=${ping?.ws ?? "unknown"}; udp_ping_ms=${ping?.udp ?? "unknown"}; retries=${status.retry_count}; last_error=${status.last_error_code ?? "none"}`;
  }

  private publicError(code: string): string {
    const messages: Record<string, string> = {
      AUTHORIZED_TARGET_NOT_SET: "No exact voice target has been authorized.",
      AUTHORIZED_TARGET_NOT_VOICE: "The authorized target is no longer a voice channel.",
      DISCORD_GATEWAY_NOT_READY: "The Discord Gateway session is not ready.",
      VOICE_NOT_CONNECTED: "The bot is not connected to the authorized voice channel.",
      VOICE_PERMISSION_LOST: "The bot no longer has View Channel and Connect permissions.",
      OPERATOR_RELAY_RATE_LIMIT: "This operator reached the relay limit.",
      DEPLOYMENT_RELAY_RATE_LIMIT: "This deployment reached the relay limit."
    };
    return messages[code] ?? `Command rejected: ${code}.`;
  }
}
