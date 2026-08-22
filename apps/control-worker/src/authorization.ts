import type { ControlAction } from "@discord-vc-control/contracts";

import type { DiscordInteraction, Env } from "./types.js";

function csvSet(value: string): ReadonlySet<string> {
  return new Set(
    value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
  );
}

export type AuthorizationResult =
  { allowed: true; actorUserId: string; elevated: boolean } | { allowed: false; code: string };

export function authorizeInteraction(
  interaction: DiscordInteraction,
  action: ControlAction,
  env: Env
): AuthorizationResult {
  if (interaction.application_id !== env.CONTROL_DISCORD_APPLICATION_ID) {
    return { allowed: false, code: "WRONG_APPLICATION" };
  }
  if (interaction.guild_id !== env.CONTROL_GUILD_ID) {
    return { allowed: false, code: "WRONG_CONTROL_GUILD" };
  }
  if (
    interaction.channel_id === undefined ||
    !csvSet(env.CONTROL_CHANNEL_IDS).has(interaction.channel_id)
  ) {
    return { allowed: false, code: "WRONG_CONTROL_CHANNEL" };
  }
  const actorUserId = interaction.member?.user?.id ?? interaction.user?.id;
  if (actorUserId === undefined) return { allowed: false, code: "MISSING_ACTOR" };
  const roles = new Set(interaction.member?.roles ?? []);
  const userAllowed = csvSet(env.CONTROL_OPERATOR_USER_IDS).has(actorUserId);
  const roleAllowed = [...csvSet(env.CONTROL_OPERATOR_ROLE_IDS)].some((role) => roles.has(role));
  if (!userAllowed && !roleAllowed) return { allowed: false, code: "UNAUTHORIZED_OPERATOR" };
  const elevated =
    csvSet(env.CONTROL_ELEVATED_USER_IDS).has(actorUserId) ||
    [...csvSet(env.CONTROL_ELEVATED_ROLE_IDS)].some((role) => roles.has(role));
  if ((action === "reconnect" || action === "audit") && !elevated) {
    return { allowed: false, code: "ELEVATED_OPERATOR_REQUIRED" };
  }
  return { allowed: true, actorUserId, elevated };
}
