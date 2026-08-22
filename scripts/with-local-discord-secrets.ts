import { spawn } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

import { readLocalDiscordSecrets } from "./local-discord-secret-file.js";

const requested = process.argv.slice(2);
if (requested[0] === "--") requested.shift();
const executable = requested.shift();
if (executable === undefined) throw new Error("LOCAL_SECRET_COMMAND_REQUIRED");

const source = resolve(process.cwd(), ".runtime", "secrets", "discord.env");
const secrets = await readLocalDiscordSecrets(source);
const child = spawn(executable, requested, {
  env: { ...process.env, ...secrets },
  shell: false,
  stdio: "inherit",
  windowsHide: true
});

const exitCode = await new Promise<number>((resolveExit, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (signal !== null) reject(new Error(`LOCAL_SECRET_COMMAND_SIGNAL_${signal}`));
    else resolveExit(code ?? 1);
  });
});

process.exitCode = exitCode;
