type DeploymentEnvironment = Partial<
  Pick<NodeJS.ProcessEnv, "CONTAINERS_ROLLOUT" | "DEPLOY_SECRETS_FILE">
>;

type RuntimeEnvironment = NodeJS.ProcessEnv;

function variable(environment: RuntimeEnvironment, name: string, fallback?: string): string {
  const value = environment[name] ?? fallback;
  if (value === undefined) throw new Error(`MISSING_${name}`);
  return `${name}:${value}`;
}

function booleanVariable(
  environment: RuntimeEnvironment,
  name: string,
  fallback = "false"
): string {
  const value = environment[name] ?? fallback;
  if (value !== "true" && value !== "false") throw new Error(`INVALID_${name}`);
  return `${name}:${value}`;
}

function optionalVariable(environment: RuntimeEnvironment, name: string): string[] {
  const value = environment[name]?.trim();
  return value ? ["--var", `${name}:${value}`] : [];
}

function variableArguments(values: string[]): string[] {
  return values.flatMap((value) => ["--var", value]);
}

export function controlDeploymentVariableArguments(environment: RuntimeEnvironment): string[] {
  const relayEnabled = environment.CONTROL_RELAY_ENABLED === "true";
  const values = [
    variable(environment, "DEPLOYMENT_ID"),
    variable(environment, "TENANT_ID"),
    variable(environment, "CONTROL_DISCORD_APPLICATION_ID"),
    variable(environment, "CONTROL_DISCORD_PUBLIC_KEY"),
    variable(environment, "CONTROL_GUILD_ID"),
    variable(environment, "CONTROL_CHANNEL_IDS"),
    variable(environment, "CONTROL_OPERATOR_USER_IDS"),
    variable(environment, "CONTROL_OPERATOR_ROLE_IDS", ""),
    variable(environment, "CONTROL_ELEVATED_USER_IDS"),
    variable(environment, "CONTROL_ELEVATED_ROLE_IDS", ""),
    booleanVariable(environment, "CONTROL_RELAY_ENABLED"),
    variable(environment, "CONTROL_RELAY_APPLICATION_ID", relayEnabled ? undefined : ""),
    variable(environment, "CONTROL_RELAY_CHANNEL_ID", relayEnabled ? undefined : ""),
    variable(environment, "AGENT_KEY_ID")
  ];
  return [...variableArguments(values), ...optionalVariable(environment, "AGENT_PREVIOUS_KEY_ID")];
}

export function voiceHostDeploymentVariableArguments(environment: RuntimeEnvironment): string[] {
  const hostEnabled = environment.HOST_ENABLED === "true";
  const probeEnabled = environment.PROBE_ENABLED === "true";
  const relayEnabled = environment.CONTROL_RELAY_ENABLED === "true";
  const relayOnly = environment.CONTROL_RELAY_ONLY === "true";
  if (hostEnabled && probeEnabled) throw new Error("HOST_AND_PROBE_CANNOT_RUN_CONCURRENTLY");
  if (relayOnly && !relayEnabled) throw new Error("CONTROL_RELAY_ONLY_REQUIRES_RELAY");

  const values = [
    variable(environment, "DEPLOYMENT_ID"),
    variable(environment, "TENANT_ID"),
    booleanVariable(environment, "HOST_ENABLED"),
    booleanVariable(environment, "PREFIX_COMMANDS_ENABLED"),
    booleanVariable(environment, "MESSAGE_CONTENT_INTENT_ENABLED"),
    booleanVariable(environment, "MANAGED_ROOMS_ENABLED"),
    variable(environment, "MANAGED_GUILD_IDS", ""),
    variable(environment, "TARGET_APPROVER_USER_IDS", ""),
    booleanVariable(environment, "CONTROL_RELAY_ENABLED"),
    booleanVariable(environment, "CONTROL_RELAY_ONLY"),
    variable(environment, "CONTROL_RELAY_APPLICATION_ID", relayEnabled ? undefined : ""),
    variable(environment, "CONTROL_GUILD_ID", relayEnabled ? undefined : ""),
    variable(environment, "CONTROL_RELAY_CHANNEL_ID", relayEnabled ? undefined : ""),
    variable(environment, "CONTROL_OPERATOR_USER_IDS", relayEnabled ? undefined : ""),
    variable(environment, "CONTROL_OPERATOR_ROLE_IDS", ""),
    variable(environment, "CONTROL_ELEVATED_USER_IDS", relayEnabled ? undefined : ""),
    variable(environment, "CONTROL_ELEVATED_ROLE_IDS", ""),
    variable(environment, "RELAY_INGRESS_ENDPOINT", relayEnabled ? undefined : ""),
    variable(environment, "AGENT_KEY_ID"),
    variable(environment, "CONTROL_AGENT_WS_URL", relayOnly ? "" : undefined),
    booleanVariable(environment, "PROBE_ENABLED"),
    variable(environment, "PROBE_GUILD_ID", probeEnabled ? undefined : ""),
    variable(environment, "PROBE_VOICE_CHANNEL_ID", probeEnabled ? undefined : ""),
    variable(environment, "PROBE_STABLE_MS", "60000")
  ];
  return [...variableArguments(values), ...optionalVariable(environment, "AGENT_PREVIOUS_KEY_ID")];
}

export function deploymentSecretsArguments(environment: DeploymentEnvironment): string[] {
  const value = environment.DEPLOY_SECRETS_FILE?.trim();
  return value ? ["--secrets-file", value] : [];
}

export function containerRolloutArguments(environment: DeploymentEnvironment): string[] {
  const value = environment.CONTAINERS_ROLLOUT?.trim();
  if (!value) return [];
  if (value !== "none" && value !== "gradual" && value !== "immediate") {
    throw new Error("INVALID_CONTAINERS_ROLLOUT");
  }
  return ["--containers-rollout", value];
}
