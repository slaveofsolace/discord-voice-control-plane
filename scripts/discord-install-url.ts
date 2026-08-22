export const VOICE_INSTALL_PERMISSIONS = {
  "presence-only": "1117184",
  "managed-rooms": "286329872"
} as const;

export type VoiceInstallProfile = keyof typeof VOICE_INSTALL_PERMISSIONS;

const DISCORD_SNOWFLAKE = /^[1-9]\d{16,19}$/u;

function requireSnowflake(value: string, label: string): string {
  const normalized = value.trim();
  if (!DISCORD_SNOWFLAKE.test(normalized)) throw new Error(`INVALID_${label}`);
  return normalized;
}

export function buildVoiceRoomsInstallUrl(input: {
  applicationId: string;
  guildId: string;
  profile: VoiceInstallProfile;
}): URL {
  const permissions = VOICE_INSTALL_PERMISSIONS[input.profile];
  if (!permissions) throw new Error("INVALID_VOICE_INSTALL_PROFILE");

  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", requireSnowflake(input.applicationId, "APPLICATION_ID"));
  url.searchParams.set("guild_id", requireSnowflake(input.guildId, "GUILD_ID"));
  url.searchParams.set("disable_guild_select", "true");
  url.searchParams.set("integration_type", "0");
  url.searchParams.set("permissions", permissions);
  url.searchParams.set("scope", "applications.commands bot");
  return url;
}
