import { describe, expect, it } from "vitest";

import {
  controlEnvironmentSchema,
  userRpcEnvironmentSchema,
  voiceEnvironmentSchema,
  voiceHostModeSchema
} from "./index.js";

const base = {
  DEPLOYMENT_ID: "test",
  TENANT_ID: "test",
  DISCORD_BOT_TOKEN: "x".repeat(40),
  AGENT_ENDPOINT: "wss://example.test/agent/ws",
  AGENT_AUTH_SECRET: "x".repeat(32),
  AGENT_KEY_ID: "v1",
  TARGET_APPROVER_USER_IDS: "100000000000000001",
  PREFIX_COMMANDS_ENABLED: "false",
  MESSAGE_CONTENT_INTENT_ENABLED: "false",
  MANAGED_ROOMS_ENABLED: "false",
  MANAGED_GUILD_IDS: "100000000000000002"
};

describe("voice environment", () => {
  it("parses explicit feature flags and snowflake lists", () => {
    const parsed = voiceEnvironmentSchema.parse(base);
    expect(parsed.PREFIX_COMMANDS_ENABLED).toBe(false);
    expect(parsed.TARGET_APPROVER_USER_IDS.has("100000000000000001")).toBe(true);
    expect(parsed.CONTROL_RELAY_ENABLED).toBe(false);
  });

  it("rejects prefix commands without the message-content intent", () => {
    expect(() =>
      voiceEnvironmentSchema.parse({ ...base, PREFIX_COMMANDS_ENABLED: "true" })
    ).toThrow("MESSAGE_CONTENT_INTENT_ENABLED");
  });

  it("requires the previous rotation key ID and secret as a pair", () => {
    expect(() => voiceEnvironmentSchema.parse({ ...base, AGENT_PREVIOUS_KEY_ID: "v0" })).toThrow(
      "configured together"
    );
    expect(() =>
      voiceEnvironmentSchema.parse({ ...base, AGENT_PREVIOUS_AUTH_SECRET: "y".repeat(32) })
    ).toThrow("configured together");
    expect(
      voiceEnvironmentSchema.parse({
        ...base,
        AGENT_PREVIOUS_KEY_ID: "v0",
        AGENT_PREVIOUS_AUTH_SECRET: "y".repeat(32)
      })
    ).toMatchObject({ AGENT_PREVIOUS_KEY_ID: "v0" });
  });

  it("enables private relay intake only with Message Content and exact locked settings", () => {
    const relay = {
      ...base,
      CONTROL_RELAY_ENABLED: "true",
      CONTROL_RELAY_APPLICATION_ID: "100000000000000010",
      CONTROL_GUILD_ID: "100000000000000011",
      CONTROL_RELAY_CHANNEL_ID: "100000000000000012",
      CONTROL_OPERATOR_USER_IDS: "100000000000000013",
      RELAY_INGRESS_ENDPOINT: "https://example.test/internal/relay-ingress",
      RELAY_INGRESS_HMAC_SECRET: "r".repeat(32)
    };
    expect(() => voiceEnvironmentSchema.parse(relay)).toThrow("MESSAGE_CONTENT_INTENT_ENABLED");
    expect(
      voiceEnvironmentSchema.parse({
        ...relay,
        MESSAGE_CONTENT_INTENT_ENABLED: "true",
        CONTROL_RELAY_ONLY: "true"
      })
    ).toMatchObject({ CONTROL_RELAY_ENABLED: true, CONTROL_RELAY_ONLY: true });
    expect(() =>
      voiceEnvironmentSchema.parse({
        ...relay,
        MESSAGE_CONTENT_INTENT_ENABLED: "true",
        CONTROL_RELAY_ONLY: "true",
        PREFIX_COMMANDS_ENABLED: "true"
      })
    ).toThrow("Relay-only mode");
  });

  it("rejects reused current and previous rotation credentials", () => {
    expect(() =>
      voiceEnvironmentSchema.parse({
        ...base,
        AGENT_PREVIOUS_KEY_ID: base.AGENT_KEY_ID,
        AGENT_PREVIOUS_AUTH_SECRET: "y".repeat(32)
      })
    ).toThrow("key IDs must differ");
    expect(() =>
      voiceEnvironmentSchema.parse({
        ...base,
        AGENT_PREVIOUS_KEY_ID: "v0",
        AGENT_PREVIOUS_AUTH_SECRET: base.AGENT_AUTH_SECRET
      })
    ).toThrow("secrets must differ");
  });
});

describe("control environment", () => {
  it("requires strong runtime secrets before the Worker can route requests", () => {
    expect(() =>
      controlEnvironmentSchema.parse({
        DEPLOYMENT_ID: "test",
        TENANT_ID: "test",
        CONTROL_DISCORD_APPLICATION_ID: "100000000000000001",
        CONTROL_DISCORD_PUBLIC_KEY: "00".repeat(32),
        CONTROL_GUILD_ID: "100000000000000002",
        CONTROL_CHANNEL_IDS: "100000000000000003",
        CONTROL_OPERATOR_USER_IDS: "100000000000000004",
        CONTROL_OPERATOR_ROLE_IDS: "",
        CONTROL_ELEVATED_USER_IDS: "100000000000000004",
        CONTROL_ELEVATED_ROLE_IDS: "",
        AGENT_KEY_ID: "v1",
        AGENT_AUTH_SECRET: "short",
        INTERNAL_STATUS_SECRET: "short"
      })
    ).toThrow();
  });

  it("keeps relay ingress disabled by default and fails closed when enabled incompletely", () => {
    const valid = {
      DEPLOYMENT_ID: "test",
      TENANT_ID: "test",
      CONTROL_DISCORD_APPLICATION_ID: "100000000000000001",
      CONTROL_DISCORD_PUBLIC_KEY: "00".repeat(32),
      CONTROL_GUILD_ID: "100000000000000002",
      CONTROL_CHANNEL_IDS: "100000000000000003",
      CONTROL_OPERATOR_USER_IDS: "100000000000000004",
      CONTROL_OPERATOR_ROLE_IDS: "",
      CONTROL_ELEVATED_USER_IDS: "100000000000000004",
      CONTROL_ELEVATED_ROLE_IDS: "",
      AGENT_KEY_ID: "v1",
      AGENT_AUTH_SECRET: "a".repeat(32),
      INTERNAL_STATUS_SECRET: "s".repeat(32)
    };
    expect(controlEnvironmentSchema.parse(valid).CONTROL_RELAY_ENABLED).toBe(false);
    expect(() =>
      controlEnvironmentSchema.parse({ ...valid, CONTROL_RELAY_ENABLED: "true" })
    ).toThrow("Enabled relay ingress");
  });
});

describe("voice host mode", () => {
  it("requires probe and production Containers to run separately", () => {
    expect(() =>
      voiceHostModeSchema.parse({
        HOST_ENABLED: "true",
        PROBE_ENABLED: "true",
        PROBE_GUILD_ID: "100000000000000001",
        PROBE_VOICE_CHANNEL_ID: "100000000000000002",
        PROBE_STABLE_MS: "60000"
      })
    ).toThrow("cannot run concurrently");
  });

  it("requires exact probe IDs and a bounded stability interval", () => {
    expect(() =>
      voiceHostModeSchema.parse({
        HOST_ENABLED: "false",
        PROBE_ENABLED: "true",
        PROBE_GUILD_ID: "",
        PROBE_VOICE_CHANNEL_ID: "",
        PROBE_STABLE_MS: "60000"
      })
    ).toThrow("exact guild and voice channel IDs");
    expect(() =>
      voiceHostModeSchema.parse({
        HOST_ENABLED: "false",
        PROBE_ENABLED: "false",
        PROBE_GUILD_ID: "",
        PROBE_VOICE_CHANNEL_ID: "",
        PROBE_STABLE_MS: "999999"
      })
    ).toThrow();
  });
});

describe("authorized local RPC environment", () => {
  const userRpcBase = {
    DEPLOYMENT_ID: "test-rpc",
    TENANT_ID: "test",
    USER_RPC_DISCORD_APPLICATION_ID: "100000000000000001",
    USER_RPC_DISCORD_ACCESS_TOKEN: "oauth-access-token-value",
    USER_RPC_ALLOWED_GUILD_ID: "100000000000000002",
    USER_RPC_EXPECTED_USER_ID: "100000000000000003",
    AGENT_ENDPOINT: "wss://example.test/agent/ws",
    AGENT_AUTH_SECRET: "x".repeat(32),
    AGENT_KEY_ID: "v1"
  };

  it("requires exact expected-user and allowed-guild bindings", () => {
    expect(userRpcEnvironmentSchema.parse(userRpcBase)).toMatchObject({
      USER_RPC_ALLOWED_GUILD_ID: "100000000000000002",
      USER_RPC_EXPECTED_USER_ID: "100000000000000003"
    });
    expect(() =>
      userRpcEnvironmentSchema.parse({ ...userRpcBase, USER_RPC_EXPECTED_USER_ID: "" })
    ).toThrow();
  });

  it("retains the same strict agent key-rotation boundary", () => {
    expect(() =>
      userRpcEnvironmentSchema.parse({ ...userRpcBase, AGENT_PREVIOUS_KEY_ID: "v0" })
    ).toThrow("configured together");
    expect(() =>
      userRpcEnvironmentSchema.parse({
        ...userRpcBase,
        AGENT_PREVIOUS_KEY_ID: "v0",
        AGENT_PREVIOUS_AUTH_SECRET: userRpcBase.AGENT_AUTH_SECRET
      })
    ).toThrow("secrets must differ");
  });
});
