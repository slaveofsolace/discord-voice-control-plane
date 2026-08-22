import {
  relayIngressRequestSchema,
  type RelayIngressRequest,
  type RelayRisk
} from "@discord-vc-control/contracts";
import { parseRelayContent, type ParsedRelayContent } from "@discord-vc-control/security";

export interface ControlRelayConfig {
  applicationId: string;
  channelId: string;
  deploymentId: string;
  elevatedRoleIds: ReadonlySet<string>;
  elevatedUserIds: ReadonlySet<string>;
  guildId: string;
  operatorRoleIds: ReadonlySet<string>;
  operatorUserIds: ReadonlySet<string>;
  tenantId: string;
}

export interface ControlRelayMessage {
  actorRoleIds: readonly string[];
  actorUserId: string;
  applicationId: string;
  attachmentCount: number;
  bot: boolean;
  channelId: string;
  content: string;
  edited: boolean;
  embedCount: number;
  guildId: string | null;
  messageId: string;
  thread: boolean;
  webhook: boolean;
}

export interface AuthorizedRelayContent {
  elevated: boolean;
  parsed: ParsedRelayContent;
  request: Extract<RelayIngressRequest, { operation: "create" }>;
}

function intersects(values: readonly string[], allowed: ReadonlySet<string>): boolean {
  return values.some((value) => allowed.has(value));
}

export function isElevatedRelayActor(
  actorUserId: string,
  actorRoleIds: readonly string[],
  config: ControlRelayConfig
): boolean {
  return (
    config.elevatedUserIds.has(actorUserId) || intersects(actorRoleIds, config.elevatedRoleIds)
  );
}

export function authorizeControlRelayMessage(
  message: ControlRelayMessage,
  config: ControlRelayConfig
): AuthorizedRelayContent {
  if (message.bot) throw new Error("RELAY_BOT_IGNORED");
  if (message.webhook) throw new Error("RELAY_WEBHOOK_REJECTED");
  if (message.edited) throw new Error("RELAY_EDIT_REJECTED");
  if (message.guildId !== config.guildId) throw new Error("WRONG_CONTROL_GUILD");
  if (message.channelId !== config.channelId) throw new Error("WRONG_CONTROL_RELAY_CHANNEL");
  if (message.thread) throw new Error("RELAY_THREAD_REJECTED");
  if (message.attachmentCount > 0) throw new Error("RELAY_ATTACHMENT_REJECTED");
  if (message.embedCount > 0) throw new Error("RELAY_EMBED_REJECTED");
  const elevated = isElevatedRelayActor(message.actorUserId, message.actorRoleIds, config);
  const operator =
    elevated ||
    config.operatorUserIds.has(message.actorUserId) ||
    intersects(message.actorRoleIds, config.operatorRoleIds);
  if (!operator) throw new Error("RELAY_ACTOR_UNAUTHORIZED");
  let parsed: ParsedRelayContent;
  try {
    parsed = parseRelayContent(message.content);
  } catch {
    throw new Error("INVALID_RELAY_GRAMMAR");
  }
  if (parsed.risk === "ELEVATED" && !elevated) {
    throw new Error("ELEVATED_OPERATOR_REQUIRED");
  }
  const request = relayIngressRequestSchema.parse({
    version: 1,
    operation: "create",
    deployment_id: config.deploymentId,
    tenant_id: config.tenantId,
    application_id: message.applicationId,
    source_message_id: message.messageId,
    actor_user_id: message.actorUserId,
    actor_role_ids: [...message.actorRoleIds],
    control_guild_id: message.guildId,
    control_channel_id: message.channelId,
    content: parsed.text
  }) as Extract<RelayIngressRequest, { operation: "create" }>;
  return { elevated, parsed, request };
}

export function authorizeRelayControlRisk(
  risk: RelayRisk,
  actorUserId: string,
  actorRoleIds: readonly string[],
  config: ControlRelayConfig
): void {
  if (risk === "ELEVATED" && !isElevatedRelayActor(actorUserId, actorRoleIds, config)) {
    throw new Error("ELEVATED_OPERATOR_REQUIRED");
  }
}
