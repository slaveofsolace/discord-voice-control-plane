import { Duplex } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  DiscordIpcClient,
  decodeRpcFrames,
  discordIpcPipePath,
  encodeRpcFrame,
  rpcOpcode
} from "./discord-ipc.js";

class FakePipe extends Duplex {
  readonly writes: Buffer[] = [];

  _read(): void {
    // Test code pushes server frames explicitly.
  }

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.writes.push(Buffer.from(chunk));
    callback();
  }

  serverSend(frame: Buffer): void {
    this.push(frame);
  }
}

function decodedPayload(frame: Buffer): Record<string, unknown> {
  const decoded = decodeRpcFrames(frame);
  expect(decoded.frames).toHaveLength(1);
  return decoded.frames[0]?.payload as Record<string, unknown>;
}

describe("Discord IPC transport", () => {
  it("uses the documented Windows pipe names and bounded frame codec", () => {
    expect(discordIpcPipePath(0)).toBe("\\\\?\\pipe\\discord-ipc-0");
    expect(() => discordIpcPipePath(10)).toThrow("INVALID_DISCORD_IPC_INDEX");
    const first = encodeRpcFrame(rpcOpcode.frame, { cmd: "ONE" });
    const second = encodeRpcFrame(rpcOpcode.frame, { cmd: "TWO" });
    const partial = Buffer.concat([first, second.subarray(0, 4)]);
    const decoded = decodeRpcFrames(partial);
    expect(decoded.frames).toEqual([{ opcode: rpcOpcode.frame, payload: { cmd: "ONE" } }]);
    expect(decoded.remainder).toEqual(second.subarray(0, 4));
  });

  it("handshakes, correlates nonces, and answers pings", async () => {
    const pipe = new FakePipe();
    const client = new DiscordIpcClient("100000000000000001", async () => pipe);
    const connecting = client.connect();
    await vi.waitFor(() => expect(pipe.writes).toHaveLength(1));
    expect(decodedPayload(pipe.writes[0] ?? Buffer.alloc(0))).toEqual({
      v: 1,
      client_id: "100000000000000001"
    });
    pipe.serverSend(
      encodeRpcFrame(rpcOpcode.frame, { cmd: "DISPATCH", evt: "READY", data: { v: 1 } })
    );
    await connecting;

    const request = client.request("GET_SELECTED_VOICE_CHANNEL");
    await vi.waitFor(() => expect(pipe.writes).toHaveLength(2));
    const outbound = decodedPayload(pipe.writes[1] ?? Buffer.alloc(0));
    expect(outbound).toMatchObject({ cmd: "GET_SELECTED_VOICE_CHANNEL", args: {} });
    pipe.serverSend(
      encodeRpcFrame(rpcOpcode.frame, {
        cmd: "GET_SELECTED_VOICE_CHANNEL",
        nonce: outbound.nonce,
        data: null
      })
    );
    await expect(request).resolves.toBeNull();

    pipe.serverSend(encodeRpcFrame(rpcOpcode.ping, { value: 7 }));
    await vi.waitFor(() => expect(pipe.writes).toHaveLength(3));
    expect(decodeRpcFrames(pipe.writes[2] ?? Buffer.alloc(0)).frames[0]).toEqual({
      opcode: rpcOpcode.pong,
      payload: { value: 7 }
    });
    client.close();
  });

  it("rejects RPC error frames without exposing their message text", async () => {
    const pipe = new FakePipe();
    const client = new DiscordIpcClient("100000000000000001", async () => pipe);
    const connecting = client.connect();
    await vi.waitFor(() => expect(pipe.writes).toHaveLength(1));
    pipe.serverSend(
      encodeRpcFrame(rpcOpcode.frame, { cmd: "DISPATCH", evt: "READY", data: { v: 1 } })
    );
    await connecting;
    const request = client.request("AUTHENTICATE", { access_token: "secret" });
    await vi.waitFor(() => expect(pipe.writes).toHaveLength(2));
    const outbound = decodedPayload(pipe.writes[1] ?? Buffer.alloc(0));
    pipe.serverSend(
      encodeRpcFrame(rpcOpcode.frame, {
        cmd: "AUTHENTICATE",
        evt: "ERROR",
        nonce: outbound.nonce,
        data: { code: 4009, message: "sensitive remote detail" }
      })
    );
    await expect(request).rejects.toThrow("DISCORD_RPC_ERROR_4009");
    client.close();
  });
});
