import { z } from "zod";

export const snowflakeSchema = z.string().regex(/^\d{17,20}$/u, "Expected a Discord snowflake");

export const voiceSessionStateSchema = z.enum([
  "DISABLED",
  "STARTING",
  "CONNECTING",
  "CONNECTED",
  "DEGRADED",
  "BACKING_OFF",
  "PAUSED",
  "BLOCKED",
  "SHUTTING_DOWN"
]);
export type VoiceSessionState = z.infer<typeof voiceSessionStateSchema>;

export const controlActionSchema = z.enum([
  "status",
  "join",
  "leave",
  "reconnect",
  "pause",
  "resume",
  "relay",
  "diagnostics",
  "audit"
]);
export type ControlAction = z.infer<typeof controlActionSchema>;

export const commandPayloadSchemas = {
  status: z.object({}),
  join: z.object({}),
  leave: z.object({}),
  reconnect: z.object({}),
  pause: z.object({}),
  resume: z.object({}),
  relay: z.object({ text: z.string().min(1).max(1000) }),
  diagnostics: z.object({}),
  audit: z.object({ limit: z.number().int().min(1).max(50).default(10) })
} as const satisfies Record<ControlAction, z.ZodType>;

export const unsignedCommandEnvelopeSchema = z
  .object({
    version: z.literal(1),
    command_id: z.uuid(),
    issued_at: z.number().int().nonnegative(),
    expires_at: z.number().int().positive(),
    nonce: z.string().min(16).max(128),
    actor_user_id: snowflakeSchema,
    control_guild_id: snowflakeSchema,
    control_channel_id: snowflakeSchema,
    deployment_id: z.string().min(1).max(64),
    tenant_id: z.string().min(1).max(64),
    action: controlActionSchema,
    payload: z.record(z.string(), z.unknown()),
    kid: z.string().min(1).max(64)
  })
  .superRefine((value, context) => {
    const result = commandPayloadSchemas[value.action].safeParse(value.payload);
    if (!result.success) {
      context.addIssue({
        code: "custom",
        message: `Invalid payload for ${value.action}: ${result.error.message}`,
        path: ["payload"]
      });
    }
    if (value.expires_at <= value.issued_at) {
      context.addIssue({
        code: "custom",
        message: "expires_at must be after issued_at",
        path: ["expires_at"]
      });
    }
  });
export type UnsignedCommandEnvelope = z.infer<typeof unsignedCommandEnvelopeSchema>;

export const commandEnvelopeSchema = unsignedCommandEnvelopeSchema.and(
  z.object({ mac: z.string().min(43).max(128) })
);
export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;

export function parseActionPayload<TAction extends ControlAction>(
  action: TAction,
  payload: unknown
): z.infer<(typeof commandPayloadSchemas)[TAction]> {
  return commandPayloadSchemas[action].parse(payload) as z.infer<
    (typeof commandPayloadSchemas)[TAction]
  >;
}

export const commandAckSchema = z.object({
  type: z.literal("ack"),
  command_id: z.uuid(),
  accepted: z.boolean(),
  duplicate: z.boolean().default(false),
  result_code: z.string().min(1).max(64),
  summary: z.string().max(500),
  target_message_id: snowflakeSchema.optional(),
  observed_state: voiceSessionStateSchema,
  occurred_at: z.number().int().nonnegative()
});
export type CommandAck = z.infer<typeof commandAckSchema>;

export const agentStatusSchema = z.object({
  type: z.literal("status"),
  deployment_id: z.string().min(1).max(64),
  desired_connected: z.boolean(),
  observed_state: voiceSessionStateSchema,
  gateway_connected: z.boolean(),
  voice_connected: z.boolean(),
  udp_established: z.boolean(),
  dave_established: z.boolean(),
  target_guild_id: snowflakeSchema.nullable(),
  target_channel_id: snowflakeSchema.nullable(),
  circuit_open: z.boolean(),
  retry_count: z.number().int().nonnegative(),
  last_error_code: z.string().max(64).nullable(),
  last_health_at: z.number().int().nonnegative()
});
export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const agentHeartbeatSchema = z.object({
  type: z.literal("heartbeat"),
  deployment_id: z.string().min(1).max(64),
  sent_at: z.number().int().nonnegative(),
  gateway_sequence: z.number().int().nullable()
});

export const managedRoomSettingsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  user_limit: z.number().int().min(0).max(99),
  locked: z.boolean(),
  permitted_user_ids: z.array(snowflakeSchema).max(100),
  banned_user_ids: z.array(snowflakeSchema).max(100)
});
export type ManagedRoomSettings = z.infer<typeof managedRoomSettingsSchema>;

export const guildConfigRecordSchema = z.object({
  deployment_id: z.string().min(1).max(64),
  guild_id: snowflakeSchema,
  feature_profile: z.enum(["presence_only", "managed_rooms"]),
  managed_rooms_enabled: z.boolean(),
  prefix_commands_enabled: z.boolean(),
  category_id: snowflakeSchema.nullable(),
  lobby_channel_id: snowflakeSchema.nullable(),
  command_channel_id: snowflakeSchema.nullable()
});
export type GuildConfigRecord = z.infer<typeof guildConfigRecordSchema>;

export const managedRoomRecordSchema = z.object({
  channel_id: snowflakeSchema,
  deployment_id: z.string().min(1).max(64),
  guild_id: snowflakeSchema,
  owner_user_id: snowflakeSchema,
  category_id: snowflakeSchema,
  settings: managedRoomSettingsSchema
});
export type ManagedRoomRecord = z.infer<typeof managedRoomRecordSchema>;

export const authorizedTargetSchema = z.object({
  deployment_id: z.string().min(1).max(64),
  guild_id: snowflakeSchema,
  voice_channel_id: snowflakeSchema,
  text_channel_id: snowflakeSchema,
  authorized_by_user_id: snowflakeSchema,
  authorized_at: z.number().int().nonnegative()
});
export type AuthorizedTarget = z.infer<typeof authorizedTargetSchema>;

export const agentBootstrapSchema = z.object({
  type: z.literal("bootstrap"),
  deployment_id: z.string().min(1).max(64),
  tenant_id: z.string().min(1).max(64),
  desired_connected: z.boolean(),
  paused: z.boolean(),
  guild_configs: z.array(guildConfigRecordSchema),
  managed_rooms: z.array(managedRoomRecordSchema),
  authorized_target: authorizedTargetSchema.nullable()
});
export type AgentBootstrap = z.infer<typeof agentBootstrapSchema>;

export const managedRoomEventSchema = z.discriminatedUnion("operation", [
  z.object({
    type: z.literal("managed_room_event"),
    operation: z.literal("upsert"),
    room: managedRoomRecordSchema
  }),
  z.object({
    type: z.literal("managed_room_event"),
    operation: z.literal("delete"),
    deployment_id: z.string().min(1).max(64),
    channel_id: snowflakeSchema,
    guild_id: snowflakeSchema,
    occurred_at: z.number().int().nonnegative()
  })
]);

export const guildConfigEventSchema = z.object({
  type: z.literal("guild_config_event"),
  config: guildConfigRecordSchema
});

export const authorizedTargetEventSchema = z.object({
  type: z.literal("authorized_target_event"),
  target: authorizedTargetSchema
});

export const agentMessageSchema = z.union([
  commandAckSchema,
  agentStatusSchema,
  agentHeartbeatSchema,
  managedRoomEventSchema,
  guildConfigEventSchema,
  authorizedTargetEventSchema
]);
export type AgentMessage = z.infer<typeof agentMessageSchema>;

export interface VoiceMachineSnapshot {
  state: VoiceSessionState;
  desiredConnected: boolean;
  retryCount: number;
  circuitOpen: boolean;
  reason: string;
}

export type VoiceMachineEvent =
  | { type: "START" }
  | { type: "CONNECT_REQUEST" }
  | { type: "DAVE_PENDING" }
  | { type: "CONNECTED" }
  | { type: "TRANSIENT_DISCONNECT"; reason: string }
  | { type: "RETRY_TIMER" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "LEAVE" }
  | { type: "MODERATOR_DISCONNECT" }
  | { type: "MODERATOR_MOVE" }
  | { type: "PERMISSION_LOST" }
  | { type: "CHANNEL_DELETED" }
  | { type: "AUTH_FAILURE" }
  | { type: "PROTOCOL_FAILURE" }
  | { type: "MAX_RETRIES" }
  | { type: "SHUTDOWN" };

const blockingEvents = new Set<VoiceMachineEvent["type"]>([
  "MODERATOR_DISCONNECT",
  "MODERATOR_MOVE",
  "PERMISSION_LOST",
  "CHANNEL_DELETED",
  "AUTH_FAILURE",
  "PROTOCOL_FAILURE",
  "MAX_RETRIES"
]);

export function transitionVoiceMachine(
  current: VoiceMachineSnapshot,
  event: VoiceMachineEvent
): VoiceMachineSnapshot {
  if (event.type === "SHUTDOWN") {
    return { ...current, state: "SHUTTING_DOWN", desiredConnected: false, reason: "shutdown" };
  }
  if (event.type === "LEAVE") {
    return {
      state: "DISABLED",
      desiredConnected: false,
      retryCount: 0,
      circuitOpen: false,
      reason: "operator_leave"
    };
  }
  if (event.type === "PAUSE") {
    return { ...current, state: "PAUSED", reason: "operator_pause" };
  }
  if (blockingEvents.has(event.type)) {
    return {
      ...current,
      state: "BLOCKED",
      desiredConnected: false,
      circuitOpen: true,
      reason: event.type.toLowerCase()
    };
  }
  switch (event.type) {
    case "START":
      return { ...current, state: "STARTING", reason: "process_start" };
    case "CONNECT_REQUEST":
      return {
        state: "CONNECTING",
        desiredConnected: true,
        retryCount: 0,
        circuitOpen: false,
        reason: "operator_join"
      };
    case "CONNECTED":
      return {
        ...current,
        state: "CONNECTED",
        desiredConnected: true,
        retryCount: 0,
        circuitOpen: false,
        reason: "voice_ready"
      };
    case "DAVE_PENDING":
      return {
        ...current,
        state: "DEGRADED",
        reason: "dave_negotiating"
      };
    case "TRANSIENT_DISCONNECT":
      if (!current.desiredConnected || current.circuitOpen || current.state === "PAUSED") {
        return current;
      }
      return {
        ...current,
        state: "BACKING_OFF",
        retryCount: current.retryCount + 1,
        reason: event.reason
      };
    case "RETRY_TIMER":
      return current.state === "BACKING_OFF" && current.desiredConnected && !current.circuitOpen
        ? { ...current, state: "CONNECTING", reason: "retry_timer" }
        : current;
    case "RESUME":
      return {
        ...current,
        state: "CONNECTING",
        desiredConnected: true,
        retryCount: 0,
        circuitOpen: false,
        reason: "operator_resume"
      };
    default:
      return current;
  }
}

export function retryDelayMs(retryCount: number, randomUnit = Math.random()): number {
  const base = Math.min(30_000, 1_000 * 2 ** Math.max(0, retryCount - 1));
  const jitter = Math.floor(base * 0.25 * Math.min(1, Math.max(0, randomUnit)));
  return base + jitter;
}
