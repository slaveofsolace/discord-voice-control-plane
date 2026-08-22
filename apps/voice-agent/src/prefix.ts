export const voiceSubcommands = [
  "info",
  "name",
  "size",
  "lock",
  "unlock",
  "permit",
  "unpermit",
  "kick",
  "ban",
  "unban",
  "reset",
  "claim"
] as const;
export type VoiceSubcommand = (typeof voiceSubcommands)[number];

const userCommands = new Set<VoiceSubcommand>(["permit", "unpermit", "kick", "ban", "unban"]);

export type ParsedPrefixCommand =
  | { subcommand: "info" | "lock" | "unlock" | "reset" | "claim" }
  | { subcommand: "name" | "size"; argument: string }
  | { subcommand: "permit" | "unpermit" | "kick" | "ban" | "unban"; userId: string };

export function parsePrefixCommand(content: string): ParsedPrefixCommand | null {
  const trimmed = content.trim();
  const lowered = trimmed.toLowerCase();
  const prefix =
    lowered === "!voice" || lowered.startsWith("!voice ")
      ? "!voice"
      : lowered === "!v" || lowered.startsWith("!v ")
        ? "!v"
        : null;
  if (prefix === null) return null;
  const remainder = trimmed.slice(prefix.length).trim();
  const firstSpace = remainder.indexOf(" ");
  const rawSubcommand = (
    firstSpace === -1 ? remainder : remainder.slice(0, firstSpace)
  ).toLowerCase();
  if (!(voiceSubcommands as readonly string[]).includes(rawSubcommand)) {
    throw new Error("UNKNOWN_VOICE_COMMAND");
  }
  const subcommand = rawSubcommand as VoiceSubcommand;
  const argument = firstSpace === -1 ? "" : remainder.slice(firstSpace + 1).trim();
  if (userCommands.has(subcommand)) {
    let userId = argument;
    if (userId.startsWith("<@") && userId.endsWith(">")) {
      userId = userId.slice(2, -1);
      if (userId.startsWith("!")) userId = userId.slice(1);
    }
    if (!/^\d{17,20}$/u.test(userId)) throw new Error("USER_MENTION_OR_ID_REQUIRED");
    return { subcommand, userId } as ParsedPrefixCommand;
  }
  if (subcommand === "name" || subcommand === "size") {
    if (argument.length === 0) throw new Error("ARGUMENT_REQUIRED");
    return { subcommand, argument };
  }
  if (argument.length > 0) throw new Error("UNEXPECTED_ARGUMENT");
  return { subcommand } as ParsedPrefixCommand;
}
