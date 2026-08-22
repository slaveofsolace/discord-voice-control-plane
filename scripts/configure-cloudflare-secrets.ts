import { spawn } from "node:child_process";

const service = process.argv[2];
const configurations: Record<string, { config: string; secrets: string[] }> = {
  control: {
    config: "apps/control-worker/wrangler.jsonc",
    secrets: ["AGENT_AUTH_SECRET", "AGENT_PREVIOUS_AUTH_SECRET", "INTERNAL_STATUS_SECRET"]
  },
  "voice-host": {
    config: "apps/voice-host-worker/wrangler.jsonc",
    secrets: [
      "DISCORD_BOT_TOKEN",
      "CONTROL_AGENT_WS_URL",
      "AGENT_AUTH_SECRET",
      "AGENT_PREVIOUS_AUTH_SECRET",
      "AGENT_PREVIOUS_KEY_ID"
    ]
  },
  probe: {
    config: "spikes/cloudflare-voice-probe/wrangler.jsonc",
    secrets: ["DISCORD_BOT_TOKEN"]
  }
};
const selected = service === undefined ? undefined : configurations[service];
if (selected === undefined) throw new Error("USAGE_SECRETS_CONTROL_VOICE_HOST_OR_PROBE");

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
for (const secret of selected.secrets) {
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
