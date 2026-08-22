import { spawnSync } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { serializeLocalDiscordSecrets } from "./local-discord-secret-file.js";

async function readHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.stdin.setRawMode === undefined) {
    throw new Error("LOCAL_SECRET_PROMPT_REQUIRES_TTY");
  }

  process.stdout.write(prompt);
  process.stdin.setEncoding("utf8");
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return await new Promise<string>((resolveValue, reject) => {
    let value = "";
    const finish = (error?: Error): void => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error === undefined) resolveValue(value);
      else reject(error);
    };
    const onData = (chunk: string): void => {
      for (const character of chunk) {
        if (character === "\u0003") {
          finish(new Error("LOCAL_SECRET_PROMPT_CANCELLED"));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\b" || character === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= " " && character !== "\u007f") value += character;
      }
    };
    process.stdin.on("data", onData);
  });
}

function assertSecret(name: string, value: string): void {
  if (value.length < 8 || /[\r\n\0]/u.test(value)) throw new Error(`INVALID_${name}`);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDirectory = resolve(repoRoot, ".runtime");
const secretDirectory = resolve(runtimeDirectory, "secrets");
const target = resolve(secretDirectory, "discord.env");

await mkdir(secretDirectory, { recursive: true, mode: 0o700 });

if (process.platform === "win32") {
  const username = process.env.USERNAME;
  if (username === undefined || username.length === 0)
    throw new Error("WINDOWS_USERNAME_UNAVAILABLE");
  const domain = process.env.USERDOMAIN;
  const account = domain === undefined || domain.length === 0 ? username : `${domain}\\${username}`;
  const acl = spawnSync(
    "icacls.exe",
    [secretDirectory, "/inheritance:r", "/grant:r", `${account}:(OI)(CI)(F)`],
    { stdio: "ignore", windowsHide: true }
  );
  if (acl.status !== 0) throw new Error("LOCAL_SECRET_ACL_FAILED");
} else {
  await chmod(secretDirectory, 0o700);
}

const botToken = await readHidden("Paste the Voice Rooms bot token: ");
const controlClientSecret = await readHidden("Paste the VC Control client secret: ");
assertSecret("DISCORD_BOT_TOKEN", botToken);
assertSecret("CONTROL_DISCORD_CLIENT_SECRET", controlClientSecret);

await writeFile(
  target,
  serializeLocalDiscordSecrets({
    DISCORD_BOT_TOKEN: botToken,
    CONTROL_DISCORD_CLIENT_SECRET: controlClientSecret
  }),
  { encoding: "utf8", flag: "wx", mode: 0o600 }
);

console.log("Stored Discord credentials in a user-only ignored local file.");
console.log(target);
