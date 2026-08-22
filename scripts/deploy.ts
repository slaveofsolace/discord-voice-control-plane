import { spawn } from "node:child_process";

const service = process.argv[2];
if (!new Set(["control", "voice-host", "probe"]).has(service ?? "")) {
  throw new Error("USAGE_DEPLOY_CONTROL_VOICE_HOST_OR_PROBE");
}
if (process.env.DEPLOY_APPROVED !== "discord-voice-control-plane") {
  throw new Error("SET_DEPLOY_APPROVED_TO_DISCORD_VOICE_CONTROL_PLANE");
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
function run(arguments_: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(pnpm, ["exec", "wrangler", ...arguments_], {
      stdio: "inherit",
      shell: false
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`WRANGLER_EXIT_${code}`))
    );
  });
}

function variable(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`MISSING_${name}`);
  return `${name}:${value}`;
}

function optionalVariable(name: string): string[] {
  const value = process.env[name]?.trim();
  return value ? ["--var", `${name}:${value}`] : [];
}

if (service === "control") {
  const config = "apps/control-worker/wrangler.jsonc";
  const vars = [
    variable("DEPLOYMENT_ID"),
    variable("TENANT_ID"),
    variable("CONTROL_DISCORD_APPLICATION_ID"),
    variable("CONTROL_DISCORD_PUBLIC_KEY"),
    variable("CONTROL_GUILD_ID"),
    variable("CONTROL_CHANNEL_IDS"),
    variable("CONTROL_OPERATOR_USER_IDS"),
    variable("CONTROL_OPERATOR_ROLE_IDS", ""),
    variable("CONTROL_ELEVATED_USER_IDS"),
    variable("CONTROL_ELEVATED_ROLE_IDS", ""),
    variable("AGENT_KEY_ID")
  ].flatMap((value) => ["--var", value]);
  vars.push(...optionalVariable("AGENT_PREVIOUS_KEY_ID"));
  const deploy = () => run(["deploy", "--config", config, ...vars]);
  const migrate = () => run(["d1", "migrations", "apply", "DB", "--remote", "--config", config]);
  if (process.env.INITIAL_D1_PROVISION === "true") {
    await deploy();
    await migrate();
    await deploy();
  } else {
    await migrate();
    await deploy();
  }
} else if (service === "voice-host") {
  const vars = [
    variable("DEPLOYMENT_ID"),
    variable("TENANT_ID"),
    variable("HOST_ENABLED", "true"),
    variable("PREFIX_COMMANDS_ENABLED", "false"),
    variable("MESSAGE_CONTENT_INTENT_ENABLED", "false"),
    variable("MANAGED_ROOMS_ENABLED", "false"),
    variable("MANAGED_GUILD_IDS", ""),
    variable("TARGET_APPROVER_USER_IDS", ""),
    variable("AGENT_KEY_ID"),
    variable("CONTROL_AGENT_WS_URL")
  ].flatMap((value) => ["--var", value]);
  vars.push(...optionalVariable("AGENT_PREVIOUS_KEY_ID"));
  await run(["deploy", "--config", "apps/voice-host-worker/wrangler.jsonc", ...vars]);
} else {
  const vars = [
    variable("PROBE_ENABLED", "true"),
    variable("PROBE_GUILD_ID"),
    variable("PROBE_VOICE_CHANNEL_ID"),
    variable("PROBE_STABLE_MS", "60000")
  ].flatMap((value) => ["--var", value]);
  await run(["deploy", "--config", "spikes/cloudflare-voice-probe/wrangler.jsonc", ...vars]);
}
