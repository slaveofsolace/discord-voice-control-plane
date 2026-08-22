import { spawn } from "node:child_process";

const service = process.argv[2];
if (!new Set(["control", "voice-host"]).has(service ?? "")) {
  throw new Error("USAGE_DEPLOY_CONTROL_OR_VOICE_HOST");
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

function booleanVariable(name: string, fallback = "false"): string {
  const value = process.env[name] ?? fallback;
  if (value !== "true" && value !== "false") throw new Error(`INVALID_${name}`);
  return `${name}:${value}`;
}

function optionalVariable(name: string): string[] {
  const value = process.env[name]?.trim();
  return value ? ["--var", `${name}:${value}`] : [];
}

function deploymentSecretsArguments(): string[] {
  const value = process.env.DEPLOY_SECRETS_FILE?.trim();
  return value ? ["--secrets-file", value] : [];
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
  const deploy = () =>
    run(["deploy", "--config", config, ...deploymentSecretsArguments(), ...vars]);
  const migrate = () => run(["d1", "migrations", "apply", "DB", "--remote", "--config", config]);
  if (process.env.INITIAL_D1_PROVISION === "true") {
    await deploy();
    await migrate();
    await deploy();
  } else {
    await migrate();
    await deploy();
  }
} else {
  const hostEnabled = process.env.HOST_ENABLED === "true";
  const probeEnabled = process.env.PROBE_ENABLED === "true";
  if (hostEnabled && probeEnabled) throw new Error("HOST_AND_PROBE_CANNOT_RUN_CONCURRENTLY");
  const vars = [
    variable("DEPLOYMENT_ID"),
    variable("TENANT_ID"),
    booleanVariable("HOST_ENABLED"),
    booleanVariable("PREFIX_COMMANDS_ENABLED"),
    booleanVariable("MESSAGE_CONTENT_INTENT_ENABLED"),
    booleanVariable("MANAGED_ROOMS_ENABLED"),
    variable("MANAGED_GUILD_IDS", ""),
    variable("TARGET_APPROVER_USER_IDS", ""),
    variable("AGENT_KEY_ID"),
    variable("CONTROL_AGENT_WS_URL"),
    booleanVariable("PROBE_ENABLED"),
    variable("PROBE_GUILD_ID", probeEnabled ? undefined : ""),
    variable("PROBE_VOICE_CHANNEL_ID", probeEnabled ? undefined : ""),
    variable("PROBE_STABLE_MS", "60000")
  ].flatMap((value) => ["--var", value]);
  vars.push(...optionalVariable("AGENT_PREVIOUS_KEY_ID"));
  await run([
    "deploy",
    "--config",
    "apps/voice-host-worker/wrangler.jsonc",
    ...deploymentSecretsArguments(),
    ...vars
  ]);
}
