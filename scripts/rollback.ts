import { spawn } from "node:child_process";

const service = process.argv[2];
const versionId = process.env.ROLLBACK_VERSION_ID?.trim();
if (process.env.ROLLBACK_APPROVED !== "discord-voice-control-plane" || !versionId) {
  throw new Error("ROLLBACK_REQUIRES_APPROVAL_AND_VERSION_ID");
}
const config =
  service === "control"
    ? "apps/control-worker/wrangler.jsonc"
    : service === "voice-host"
      ? "apps/voice-host-worker/wrangler.jsonc"
      : service === "probe"
        ? "spikes/cloudflare-voice-probe/wrangler.jsonc"
        : undefined;
if (config === undefined) throw new Error("USAGE_ROLLBACK_CONTROL_VOICE_HOST_OR_PROBE");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
await new Promise<void>((resolve, reject) => {
  const child = spawn(pnpm, ["exec", "wrangler", "rollback", versionId, "--config", config], {
    stdio: "inherit",
    shell: false
  });
  child.once("error", reject);
  child.once("exit", (code) =>
    code === 0 ? resolve() : reject(new Error(`ROLLBACK_EXIT_${code}`))
  );
});
console.log(
  "Worker rollback requested. Follow the D1, command-disablement, token-rotation, and audit-purge runbook separately."
);
