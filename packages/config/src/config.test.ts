import { describe, expect, it } from "vitest";

import { controlEnvironmentSchema, voiceEnvironmentSchema, voiceHostModeSchema } from "./index.js";

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
