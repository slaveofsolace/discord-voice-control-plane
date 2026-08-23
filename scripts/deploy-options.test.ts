import { describe, expect, it } from "vitest";

import {
  containerRolloutArguments,
  controlDeploymentVariableArguments,
  deploymentSecretsArguments,
  voiceHostDeploymentVariableArguments
} from "./deploy-options.js";

function values(arguments_: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    expect(arguments_[index]).toBe("--var");
    const argument = arguments_[index + 1];
    if (argument === undefined) throw new Error("MISSING_VARIABLE_ARGUMENT");
    const [name, ...rest] = argument.split(":");
    if (name === undefined || name.length === 0) throw new Error("MISSING_VARIABLE_NAME");
    result.set(name, rest.join(":"));
  }
  return result;
}

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

  it("passes the control relay identity and exact channel to the control Worker", () => {
    const result = values(
      controlDeploymentVariableArguments({
        AGENT_KEY_ID: "v1",
        CONTROL_CHANNEL_IDS: "100000000000000003",
        CONTROL_DISCORD_APPLICATION_ID: "100000000000000001",
        CONTROL_DISCORD_PUBLIC_KEY: "public-key",
        CONTROL_ELEVATED_USER_IDS: "100000000000000004",
        CONTROL_GUILD_ID: "100000000000000002",
        CONTROL_OPERATOR_USER_IDS: "100000000000000004",
        CONTROL_RELAY_APPLICATION_ID: "100000000000000005",
        CONTROL_RELAY_CHANNEL_ID: "100000000000000006",
        CONTROL_RELAY_ENABLED: "true",
        DEPLOYMENT_ID: "private-lab",
        TENANT_ID: "owner"
      })
    );
    expect(result.get("CONTROL_RELAY_ENABLED")).toBe("true");
    expect(result.get("CONTROL_RELAY_APPLICATION_ID")).toBe("100000000000000005");
    expect(result.get("CONTROL_RELAY_CHANNEL_ID")).toBe("100000000000000006");
  });

  it("passes the complete relay allowlist and ingress boundary to the voice host", () => {
    const result = values(
      voiceHostDeploymentVariableArguments({
        AGENT_KEY_ID: "v1",
        CONTROL_ELEVATED_ROLE_IDS: "100000000000000011",
        CONTROL_ELEVATED_USER_IDS: "100000000000000010",
        CONTROL_GUILD_ID: "100000000000000002",
        CONTROL_OPERATOR_ROLE_IDS: "100000000000000009",
        CONTROL_OPERATOR_USER_IDS: "100000000000000004",
        CONTROL_RELAY_APPLICATION_ID: "100000000000000005",
        CONTROL_RELAY_CHANNEL_ID: "100000000000000006",
        CONTROL_RELAY_ENABLED: "true",
        CONTROL_RELAY_ONLY: "true",
        DEPLOYMENT_ID: "private-lab",
        HOST_ENABLED: "true",
        MANAGED_ROOMS_ENABLED: "false",
        MESSAGE_CONTENT_INTENT_ENABLED: "true",
        PREFIX_COMMANDS_ENABLED: "false",
        PROBE_ENABLED: "false",
        RELAY_INGRESS_ENDPOINT: "https://control.example/internal/relay-ingress",
        TENANT_ID: "owner"
      })
    );
    expect(result.get("CONTROL_RELAY_ENABLED")).toBe("true");
    expect(result.get("CONTROL_RELAY_ONLY")).toBe("true");
    expect(result.get("CONTROL_RELAY_APPLICATION_ID")).toBe("100000000000000005");
    expect(result.get("CONTROL_GUILD_ID")).toBe("100000000000000002");
    expect(result.get("CONTROL_RELAY_CHANNEL_ID")).toBe("100000000000000006");
    expect(result.get("CONTROL_OPERATOR_USER_IDS")).toBe("100000000000000004");
    expect(result.get("CONTROL_OPERATOR_ROLE_IDS")).toBe("100000000000000009");
    expect(result.get("CONTROL_ELEVATED_USER_IDS")).toBe("100000000000000010");
    expect(result.get("CONTROL_ELEVATED_ROLE_IDS")).toBe("100000000000000011");
    expect(result.get("RELAY_INGRESS_ENDPOINT")).toBe(
      "https://control.example/internal/relay-ingress"
    );
    expect(result.get("CONTROL_AGENT_WS_URL")).toBe("");
  });

  it("requires exact relay values whenever the relay is enabled", () => {
    expect(() =>
      voiceHostDeploymentVariableArguments({
        AGENT_KEY_ID: "v1",
        CONTROL_RELAY_ENABLED: "true",
        CONTROL_RELAY_ONLY: "true",
        DEPLOYMENT_ID: "private-lab",
        HOST_ENABLED: "true",
        PROBE_ENABLED: "false",
        TENANT_ID: "owner"
      })
    ).toThrow("MISSING_CONTROL_RELAY_APPLICATION_ID");
  });

  it("rejects relay-only mode when relay intake is disabled", () => {
    expect(() =>
      voiceHostDeploymentVariableArguments({
        AGENT_KEY_ID: "v1",
        CONTROL_AGENT_WS_URL: "wss://control.example/agent/ws",
        CONTROL_RELAY_ENABLED: "false",
        CONTROL_RELAY_ONLY: "true",
        DEPLOYMENT_ID: "private-lab",
        HOST_ENABLED: "true",
        PROBE_ENABLED: "false",
        TENANT_ID: "owner"
      })
    ).toThrow("CONTROL_RELAY_ONLY_REQUIRES_RELAY");
  });
});
