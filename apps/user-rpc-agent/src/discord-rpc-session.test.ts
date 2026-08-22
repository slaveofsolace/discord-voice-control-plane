import { describe, expect, it, vi } from "vitest";

import { type DiscordIpcClient } from "./discord-ipc.js";
import { DiscordRpcSession } from "./discord-rpc-session.js";

describe("authorized Discord RPC session", () => {
  it("includes the application ID and only requests bounded approved scopes", async () => {
    const request = vi.fn().mockResolvedValue({ code: "authorization-code" });
    const ipc = { request } as unknown as DiscordIpcClient;
    const session = new DiscordRpcSession(ipc, "100000000000000001");
    await expect(session.authorize()).resolves.toBe("authorization-code");
    expect(request).toHaveBeenCalledWith("AUTHORIZE", {
      client_id: "100000000000000001",
      scopes: ["rpc", "identify"]
    });
    await expect(session.authorize(["messages.write"])).rejects.toThrow("UNSUPPORTED_RPC_SCOPE");
  });

  it("never forces a voice move unless the caller explicitly requests it", async () => {
    const request = vi.fn().mockResolvedValue({
      id: "100000000000000003",
      guild_id: "100000000000000002",
      name: "voice",
      type: 2
    });
    const ipc = { request } as unknown as DiscordIpcClient;
    const session = new DiscordRpcSession(ipc, "100000000000000001");
    await session.selectVoiceChannel("100000000000000003");
    expect(request).toHaveBeenCalledWith(
      "SELECT_VOICE_CHANNEL",
      {
        channel_id: "100000000000000003",
        timeout: 10_000,
        navigate: false
      },
      { timeoutMs: 15_000 }
    );
  });
});
