import { spawn } from "node:child_process";

import {
  containerRolloutArguments,
  controlDeploymentVariableArguments,
  deploymentSecretsArguments,
  voiceHostDeploymentVariableArguments
} from "./deploy-options.js";

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

if (service === "control") {
  const config = "apps/control-worker/wrangler.jsonc";
  const vars = controlDeploymentVariableArguments(process.env);
  const deploy = () =>
    run(["deploy", "--config", config, ...deploymentSecretsArguments(process.env), ...vars]);
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
  const vars = voiceHostDeploymentVariableArguments(process.env);
  await run([
    "deploy",
    "--config",
    "apps/voice-host-worker/wrangler.jsonc",
    ...deploymentSecretsArguments(process.env),
    ...containerRolloutArguments(process.env),
    ...vars
  ]);
}
