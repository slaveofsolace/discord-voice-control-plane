import { describe, expect, it } from "vitest";

import { commandFixture } from "@discord-vc-control/testing";

import {
  FixedWindowRateLimiter,
  ReplayGuard,
  agentHandshakePayload,
  canonicalJson,
  redactSecrets,
  sanitizeRelayText,
  signAgentHandshake,
  signCommandEnvelope,
  verifyAgentHandshake,
  verifyCommandEnvelope
} from "./index.js";

const secret = "fixture-secret-with-at-least-thirty-two-bytes";

describe("command authentication", () => {
  it("canonicalizes object keys deterministically", () => {
    expect(canonicalJson({ z: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"z":1}');
  });

  it("signs and verifies a current envelope", async () => {
    const unsigned = commandFixture();
    const signed = await signCommandEnvelope(unsigned, secret);
    await expect(
      verifyCommandEnvelope(signed, {
        nowMs: unsigned.issued_at,
        secretsByKeyId: new Map([[unsigned.kid, secret]])
      })
    ).resolves.toEqual(signed);
  });

  it("rejects tampering, expiration, and unknown keys", async () => {
    const unsigned = commandFixture();
    const signed = await signCommandEnvelope(unsigned, secret);
    await expect(
      verifyCommandEnvelope(
        { ...signed, payload: { changed: true } },
        {
          nowMs: unsigned.issued_at,
          secretsByKeyId: new Map([[unsigned.kid, secret]])
        }
      )
    ).rejects.toThrow("INVALID_COMMAND_MAC");
    await expect(
      verifyCommandEnvelope(signed, {
        nowMs: unsigned.expires_at + 10_000,
        allowedClockSkewMs: 0,
        secretsByKeyId: new Map([[unsigned.kid, secret]])
      })
    ).rejects.toThrow("COMMAND_EXPIRED");
    await expect(
      verifyCommandEnvelope(signed, { nowMs: unsigned.issued_at, secretsByKeyId: new Map() })
    ).rejects.toThrow("UNKNOWN_KEY_ID");
  });

  it("accepts the previous rotation key only while it remains configured", async () => {
    const unsigned = { ...commandFixture(), kid: "previous-v1" };
    const signed = await signCommandEnvelope(unsigned, secret);
    await expect(
      verifyCommandEnvelope(signed, {
        nowMs: unsigned.issued_at,
        secretsByKeyId: new Map([
          ["current-v2", "current-secret-with-at-least-thirty-two-bytes"],
          ["previous-v1", secret]
        ])
      })
    ).resolves.toEqual(signed);
    await expect(
      verifyCommandEnvelope(signed, {
        nowMs: unsigned.issued_at,
        secretsByKeyId: new Map([["current-v2", "current-secret-with-at-least-thirty-two-bytes"]])
      })
    ).rejects.toThrow("UNKNOWN_KEY_ID");
  });

  it("signs the WebSocket challenge without transmitting the shared secret", async () => {
    const payload = agentHandshakePayload({
      agentId: "deployment",
      method: "get",
      nonce: "nonce-long-enough-0001",
      path: "/agent/ws",
      timestamp: 123
    });
    const signature = await signAgentHandshake(payload, secret);
    expect(payload).not.toContain(secret);
    await expect(verifyAgentHandshake(payload, signature, secret)).resolves.toBe(true);
    await expect(verifyAgentHandshake(`${payload}x`, signature, secret)).resolves.toBe(false);
  });
});

describe("replay, relay, and redaction controls", () => {
  it("rejects nonce replay until the retention window expires", () => {
    const guard = new ReplayGuard(100);
    expect(guard.accept("nonce", 0)).toBe(true);
    expect(guard.accept("nonce", 50)).toBe(false);
    expect(guard.accept("nonce", 101)).toBe(true);
  });

  it("normalizes relay text and rejects command or control text", () => {
    expect(sanitizeRelayText("  cafe\u0301  ")).toBe("café");
    expect(() => sanitizeRelayText("/third-party command")).toThrow("RELAY_COMMAND_TEXT_REJECTED");
    expect(() => sanitizeRelayText("!voice lock", { rejectedPrefixes: ["!voice", "!v"] })).toThrow(
      "RELAY_COMMAND_TEXT_REJECTED"
    );
    expect(() => sanitizeRelayText("!VOICE lock", { rejectedPrefixes: ["!voice", "!v"] })).toThrow(
      "RELAY_COMMAND_TEXT_REJECTED"
    );
    expect(() => sanitizeRelayText("line one\nline two")).toThrow("RELAY_CONTROL_CHARACTER");
    expect(() => sanitizeRelayText("tab\ttext")).toThrow("RELAY_CONTROL_CHARACTER");
    expect(() => sanitizeRelayText("control\u0085text")).toThrow("RELAY_CONTROL_CHARACTER");
    expect(() => sanitizeRelayText("hidden\u202Etext")).toThrow("RELAY_CONTROL_CHARACTER");
    expect(() => sanitizeRelayText("x".repeat(1001))).toThrow("RELAY_TOO_LONG");
  });

  it("applies per-key fixed-window limits", () => {
    const limiter = new FixedWindowRateLimiter(2, 1000);
    expect(limiter.consume("actor", 0)).toBe(true);
    expect(limiter.consume("actor", 1)).toBe(true);
    expect(limiter.consume("actor", 2)).toBe(false);
    expect(limiter.consume("actor", 1000)).toBe(true);
  });

  it("redacts named secrets and credential-shaped fields", () => {
    const value = redactSecrets("token=visible secret=hidden marker-12345678", ["marker-12345678"]);
    expect(value).not.toContain("visible");
    expect(value).not.toContain("hidden");
    expect(value).not.toContain("marker-12345678");
  });
});
