import { readFile } from "node:fs/promises";

export interface LocalDiscordSecrets {
  CONTROL_DISCORD_CLIENT_SECRET: string;
  DISCORD_BOT_TOKEN: string;
}

const secretNames = ["DISCORD_BOT_TOKEN", "CONTROL_DISCORD_CLIENT_SECRET"] as const;

export function serializeLocalDiscordSecrets(secrets: LocalDiscordSecrets): string {
  return `${secretNames.map((name) => `${name}=${JSON.stringify(secrets[name])}`).join("\n")}\n`;
}

export function parseLocalDiscordSecrets(source: string): LocalDiscordSecrets {
  const parsed = new Map<string, string>();
  for (const line of source.split(/\r?\n/u)) {
    if (line.length === 0) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error("INVALID_LOCAL_DISCORD_SECRET_FILE");
    const name = line.slice(0, separator);
    if (!secretNames.includes(name as (typeof secretNames)[number]) || parsed.has(name)) {
      throw new Error("INVALID_LOCAL_DISCORD_SECRET_FILE");
    }
    const value = JSON.parse(line.slice(separator + 1)) as unknown;
    if (typeof value !== "string" || value.length === 0) {
      throw new Error("INVALID_LOCAL_DISCORD_SECRET_FILE");
    }
    parsed.set(name, value);
  }

  const botToken = parsed.get("DISCORD_BOT_TOKEN");
  const controlClientSecret = parsed.get("CONTROL_DISCORD_CLIENT_SECRET");
  if (botToken === undefined || controlClientSecret === undefined) {
    throw new Error("INVALID_LOCAL_DISCORD_SECRET_FILE");
  }
  return {
    DISCORD_BOT_TOKEN: botToken,
    CONTROL_DISCORD_CLIENT_SECRET: controlClientSecret
  };
}

export async function readLocalDiscordSecrets(path: string): Promise<LocalDiscordSecrets> {
  // The caller supplies the fixed ignored runtime path; this helper never accepts network input.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return parseLocalDiscordSecrets(await readFile(path, "utf8"));
}
