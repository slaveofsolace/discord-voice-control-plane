import { spawn } from "node:child_process";

const service = process.argv[2];
const includePrevious = process.argv.includes("--include-previous");
const configurations: Record<
  string,
  { config: string; optionalSecrets?: string[]; requiredSecrets: string[] }
> = {
  control: {
    config: "apps/control-worker/wrangler.jsonc",
    requiredSecrets: ["AGENT_AUTH_SECRET", "INTERNAL_STATUS_SECRET"],
    optionalSecrets: ["AGENT_PREVIOUS_AUTH_SECRET"]
  },
  "voice-host": {
    config: "apps/voice-host-worker/wrangler.jsonc",
    requiredSecrets: ["DISCORD_BOT_TOKEN", "AGENT_AUTH_SECRET"],
    optionalSecrets: ["AGENT_PREVIOUS_AUTH_SECRET"]
  }
};
const selected = service === undefined ? undefined : configurations[service];
if (selected === undefined) throw new Error("USAGE_SECRETS_CONTROL_OR_VOICE_HOST");

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const secrets = [
  ...selected.requiredSecrets,
  ...(includePrevious ? (selected.optionalSecrets ?? []) : [])
];
for (const secret of secrets) {
  await new Promise<void>((resolve, reject) => {
    console.log(`Protected prompt for ${secret}`);
    const child = spawn(
      pnpm,
      ["exec", "wrangler", "secret", "put", secret, "--config", selected.config],
      { stdio: "inherit", shell: false }
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`SECRET_PUT_EXIT_${code}`))
    );
  });
}
