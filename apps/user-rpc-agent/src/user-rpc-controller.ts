import {
  parseActionPayload,
  transitionVoiceMachine,
  type AgentStatus,
  type AuthorizedTarget,
  type CommandAck,
  type CommandEnvelope,
  type RelayRequest,
  type VoiceMachineEvent,
  type VoiceMachineSnapshot
} from "@discord-vc-control/contracts";
import { FixedWindowRateLimiter, parseRelayContent } from "@discord-vc-control/security";

import {
  type DiscordRpcSession,
  type RpcChannel,
  type VoiceSelection
} from "./discord-rpc-session.js";
import { type DraftHandoff } from "./draft-handoff.js";
import { type EncryptedRelayQueue } from "./relay-queue.js";

export interface UserRpcControllerOptions {
  allowedGuildId: string;
  deploymentId: string;
  draftHandoff: DraftHandoff;
  profileName: string;
  relayQueue: Pick<
    EncryptedRelayQueue,
    "enqueue" | "expire" | "get" | "invalidateContext" | "list" | "transition"
  >;
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
  #accessToken: string | null = null;
  #expectedUserId: string | null = null;
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
  #targetInitialized = false;
  #targetRevision = 0;
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
    this.#accessToken = accessToken;
    this.#expectedUserId = expectedUserId;
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
      this.#target?.text_channel_id !== target?.text_channel_id ||
      this.#target?.authorized_at !== target?.authorized_at ||
      this.#target?.authorized_by_user_id !== target?.authorized_by_user_id;
    const authorizationChanged = this.#targetInitialized && changed;
    const oldTargetSelected = this.isTargetSelected();
    this.#target = target;
    if (changed) {
      this.#targetRevision += 1;
      await this.options.relayQueue.invalidateContext({
        profileName: this.options.profileName,
        force: authorizationChanged,
        targetGuildId: target?.guild_id ?? null,
        targetTextChannelId: target?.text_channel_id ?? null,
        targetVoiceChannelId: target?.voice_channel_id ?? null
      });
    }
    this.#targetInitialized = true;
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
          await this.enqueueRelay(command);
          resultCode = "PENDING_USER_APPROVAL";
          summary = "Relay request is encrypted locally and waiting for the account owner.";
          break;
        case "relay_cancel":
          await this.cancelRelay(parseActionPayload("relay_cancel", command.payload).request_id);
          resultCode = "REQUEST_CANCELLED";
          summary = "Relay request cancelled before manual send.";
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
    this.#accessToken = null;
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

  async listRelayRequests(): Promise<RelayRequest[]> {
    return this.options.relayQueue.list();
  }

  async prepareRelay(requestId: string): Promise<RelayRequest> {
    const request = await this.options.relayQueue.get(requestId);
    if (request === null) throw new Error("RELAY_REQUEST_NOT_FOUND");
    if (request.status !== "PENDING_USER_APPROVAL" && request.status !== "RECEIVED") {
      throw new Error("RELAY_REQUEST_NOT_PENDING");
    }
    if (request.content === null) throw new Error("RELAY_CONTENT_PURGED");
    if (!this.#rpcConnected || this.#accessToken === null || this.#expectedUserId === null) {
      throw new Error("DISCORD_RPC_NOT_CONNECTED");
    }
    const authenticated = await this.options.rpc.authenticate(this.#accessToken);
    if (authenticated.userId !== this.#expectedUserId || !authenticated.scopes.includes("rpc")) {
      this.block("RPC_AUTHORIZED_USER_MISMATCH", "AUTH_FAILURE");
      throw new Error("RPC_AUTHORIZED_USER_MISMATCH");
    }
    const target = this.requireTarget();
    const targetRevision = this.#targetRevision;
    await this.assertRelayPreparationContext(requestId, request, target, targetRevision);
    const selectedVoice = await this.options.rpc.getSelectedVoiceChannel();
    this.#selectedChannel = selectedVoice;
    if (
      selectedVoice?.id !== target.voice_channel_id ||
      selectedVoice.guild_id !== target.guild_id ||
      selectedVoice.type !== 2
    ) {
      throw new Error("RPC_VOICE_NOT_CONNECTED");
    }
    await this.assertRelayPreparationContext(requestId, request, target, targetRevision);
    const selectedText = await this.options.rpc.selectTextChannel(target.text_channel_id);
    if (selectedText?.id !== target.text_channel_id || selectedText.guild_id !== target.guild_id) {
      throw new Error("RPC_TEXT_SELECTION_MISMATCH");
    }
    const current = await this.assertRelayPreparationContext(
      requestId,
      request,
      target,
      targetRevision
    );
    if (current.content === null) throw new Error("RELAY_CONTENT_PURGED");
    await this.options.draftHandoff.stage(current.content);
    return this.options.relayQueue.transition(
      requestId,
      "PREPARED_FOR_MANUAL_SEND",
      "PREPARED_FOR_MANUAL_SEND"
    );
  }

  async rejectRelay(requestId: string): Promise<RelayRequest> {
    return this.options.relayQueue.transition(requestId, "OWNER_REJECTED", "OWNER_REJECTED");
  }

  async expireRelay(requestId: string): Promise<RelayRequest> {
    return this.options.relayQueue.transition(requestId, "EXPIRED", "REQUEST_EXPIRED");
  }

  async markRelaySent(requestId: string): Promise<RelayRequest> {
    return this.options.relayQueue.transition(
      requestId,
      "OWNER_CONFIRMED_SENT",
      "OWNER_CONFIRMED_SENT"
    );
  }

  async markRelayNotSent(requestId: string): Promise<RelayRequest> {
    return this.options.relayQueue.transition(
      requestId,
      "PENDING_USER_APPROVAL",
      "PENDING_USER_APPROVAL"
    );
  }

  async cancelRelay(requestId: string): Promise<RelayRequest> {
    return this.options.relayQueue.transition(requestId, "CANCELLED", "REQUEST_CANCELLED");
  }

  private async assertRelayPreparationContext(
    requestId: string,
    original: RelayRequest,
    target: AuthorizedTarget,
    targetRevision: number
  ): Promise<RelayRequest> {
    const current = await this.options.relayQueue.get(requestId);
    const targetChanged =
      this.#targetRevision !== targetRevision ||
      this.#target?.guild_id !== target.guild_id ||
      this.#target.voice_channel_id !== target.voice_channel_id ||
      this.#target.text_channel_id !== target.text_channel_id;
    const requestChanged =
      current === null ||
      (current.status !== "PENDING_USER_APPROVAL" && current.status !== "RECEIVED") ||
      current.profile_name !== this.options.profileName ||
      current.deployment_id !== this.options.deploymentId ||
      current.target_guild_id !== target.guild_id ||
      current.target_voice_channel_id !== target.voice_channel_id ||
      current.target_text_channel_id !== target.text_channel_id ||
      current.content !== original.content;
    if (targetChanged || requestChanged) throw new Error("RELAY_TARGET_CHANGED");
    return current;
  }

  private async enqueueRelay(command: CommandEnvelope): Promise<void> {
    const target = this.requireTarget();
    if (!this.#rpcConnected) throw new Error("DISCORD_RPC_NOT_CONNECTED");
    if (!this.#operatorDraftLimiter.consume(command.actor_user_id)) {
      throw new Error("OPERATOR_DRAFT_RATE_LIMIT");
    }
    if (!this.#deploymentDraftLimiter.consume(this.options.deploymentId)) {
      throw new Error("DEPLOYMENT_DRAFT_RATE_LIMIT");
    }
    const payload = parseActionPayload("relay", command.payload);
    const parsed = parseRelayContent(payload.text);
    if (
      (payload.content_kind !== undefined && payload.content_kind !== parsed.contentKind) ||
      (payload.risk !== undefined && payload.risk !== parsed.risk) ||
      (payload.parsed_command !== undefined &&
        JSON.stringify(payload.parsed_command) !== JSON.stringify(parsed.parsedCommand))
    ) {
      throw new Error("INVALID_RELAY_GRAMMAR");
    }
    const now = Date.now();
    await this.options.relayQueue.enqueue({
      request_id: payload.request_id ?? command.command_id,
      command_id: command.command_id,
      deployment_id: command.deployment_id,
      tenant_id: command.tenant_id,
      profile_name: this.options.profileName,
      source_application_id: payload.source_application_id ?? null,
      source_message_id: payload.source_message_id ?? null,
      actor_user_id: command.actor_user_id,
      actor_role_ids: payload.actor_role_ids ?? [],
      control_guild_id: command.control_guild_id,
      control_channel_id: command.control_channel_id,
      target_guild_id: target.guild_id,
      target_voice_channel_id: target.voice_channel_id,
      target_text_channel_id: target.text_channel_id,
      content_kind: parsed.contentKind,
      risk: parsed.risk,
      parsed_command: parsed.parsedCommand,
      content: parsed.text,
      status: "RECEIVED",
      result_code: "PENDING_USER_APPROVAL",
      created_at: now,
      updated_at: now,
      expires_at: now + 30 * 60_000
    });
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
      DEPLOYMENT_DRAFT_RATE_LIMIT: "This deployment reached the local draft limit.",
      RELAY_QUEUE_FULL: "The local approval queue is full.",
      INVALID_RELAY_GRAMMAR: "The relay content did not match the allowed grammar."
    };
    return messages[code] ?? `Command rejected: ${code}.`;
  }
}
