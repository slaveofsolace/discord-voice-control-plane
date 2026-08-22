import { describe, expect, it } from "vitest";

import { commandEnvelopeSchema, commandLifetimeMs, parseActionPayload } from "./index.js";

const validEnvelope = {
  version: 1,
  command_id: "123e4567-e89b-42d3-a456-426614174000",
  issued_at: 100,
  expires_at: 100 + commandLifetimeMs,
  nonce: "nonce-long-enough-0001",
  actor_user_id: "100000000000000001",
  control_guild_id: "100000000000000002",
  control_channel_id: "100000000000000003",
  deployment_id: "test",
  tenant_id: "test",
  action: "status",
  payload: {},
  kid: "v1",
  mac: "x".repeat(43)
} as const;

describe("command contracts", () => {
  it("validates action-specific payloads", () => {
    expect(parseActionPayload("relay", { text: "hello" })).toEqual({ text: "hello" });
    expect(() => parseActionPayload("relay", { text: "" })).toThrow();
    expect(() => parseActionPayload("audit", { limit: 51 })).toThrow();
  });

  it("rejects invalid envelope timing and snowflakes", () => {
    expect(() =>
      commandEnvelopeSchema.parse({
        ...validEnvelope,
        expires_at: 99
      })
    ).toThrow();
    expect(() =>
      commandEnvelopeSchema.parse({ ...validEnvelope, actor_user_id: "not-a-snowflake" })
    ).toThrow();
  });

  it("rejects a command lifetime longer than 30 seconds", () => {
    expect(() =>
      commandEnvelopeSchema.parse({
        ...validEnvelope,
        expires_at: validEnvelope.issued_at + commandLifetimeMs + 1
      })
    ).toThrow(/command lifetime must not exceed 30000 milliseconds/u);
  });
});
