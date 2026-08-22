export const voiceAdminSubcommands = [
  "setup",
  "status",
  "enable",
  "disable",
  "authorize-target"
] as const;

export type VoiceAdminSubcommand = (typeof voiceAdminSubcommands)[number];

const voiceAdminSubcommandSet = new Set<string>(voiceAdminSubcommands);

export function asVoiceAdminSubcommand(value: string): VoiceAdminSubcommand {
  if (!voiceAdminSubcommandSet.has(value)) throw new Error("UNKNOWN_VOICE_ADMIN_COMMAND");
  return value as VoiceAdminSubcommand;
}

export function requiresManageChannels(subcommand: VoiceAdminSubcommand): boolean {
  return subcommand !== "authorize-target";
}
