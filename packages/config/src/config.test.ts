import { describe, expect, it } from "vitest";

import { voiceEnvironmentSchema } from "./index.js";

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
  MANAGED_ROOMS_ENABLED: "false"
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
});
