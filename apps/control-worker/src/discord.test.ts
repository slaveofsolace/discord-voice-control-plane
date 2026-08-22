import { describe, expect, it } from "vitest";

import { verifyDiscordRequest } from "./discord.js";

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("Discord request signatures", () => {
  it("verifies the untouched body and rejects tampering or stale timestamps", async () => {
    const keys = (await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify"
    ])) as CryptoKeyPair;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = '{"type":1}';
    const signature = await crypto.subtle.sign(
      "Ed25519",
      keys.privateKey,
      new TextEncoder().encode(`${timestamp}${body}`)
    );
    const publicKey = await crypto.subtle.exportKey("raw", keys.publicKey);
    const request = new Request("https://control.test/discord/interactions", {
      method: "POST",
      headers: {
        "x-signature-ed25519": hex(signature),
        "x-signature-timestamp": timestamp
      },
      body
    });

    await expect(verifyDiscordRequest(request, body, hex(publicKey))).resolves.toBe(true);
    await expect(verifyDiscordRequest(request, `${body} `, hex(publicKey))).resolves.toBe(false);
    await expect(
      verifyDiscordRequest(request, body, hex(publicKey), Number(timestamp) * 1000 + 300_001)
    ).resolves.toBe(false);
  });

  it("rejects missing or malformed signature headers", async () => {
    await expect(
      verifyDiscordRequest(
        new Request("https://control.test/discord/interactions", { method: "POST" }),
        "{}",
        "00".repeat(32)
      )
    ).resolves.toBe(false);
  });
});
