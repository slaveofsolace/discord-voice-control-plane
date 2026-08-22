import { describe, expect, it } from "vitest";

import { containerRolloutArguments, deploymentSecretsArguments } from "./deploy-options.js";

describe("deployment options", () => {
  it("passes a secrets file as a separate Wrangler argument", () => {
    expect(
      deploymentSecretsArguments({ DEPLOY_SECRETS_FILE: " C:\\private\\control.env " })
    ).toEqual(["--secrets-file", "C:\\private\\control.env"]);
  });

  it("omits an empty secrets-file option", () => {
    expect(deploymentSecretsArguments({ DEPLOY_SECRETS_FILE: "  " })).toEqual([]);
  });

  it.each(["none", "gradual", "immediate"])("accepts the %s Container rollout", (value) => {
    expect(containerRolloutArguments({ CONTAINERS_ROLLOUT: value })).toEqual([
      "--containers-rollout",
      value
    ]);
  });

  it("rejects any other Container rollout", () => {
    expect(() => containerRolloutArguments({ CONTAINERS_ROLLOUT: "force" })).toThrow(
      "INVALID_CONTAINERS_ROLLOUT"
    );
  });
});
