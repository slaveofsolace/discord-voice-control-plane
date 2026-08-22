type DeploymentEnvironment = Partial<
  Pick<NodeJS.ProcessEnv, "CONTAINERS_ROLLOUT" | "DEPLOY_SECRETS_FILE">
>;

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
