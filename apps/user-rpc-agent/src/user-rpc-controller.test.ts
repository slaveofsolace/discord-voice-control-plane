import { describe, expect, it, vi } from "vitest";

import { commandFixture } from "@discord-vc-control/testing";
import { type CommandEnvelope, type UnsignedCommandEnvelope } from "@discord-vc-control/contracts";

import { type DiscordRpcSession, type RpcChannel } from "./discord-rpc-session.js";
import { UserRpcController } from "./user-rpc-controller.js";

const ids = {
  actor: "100000000000000001",
  allowedGuild: "100000000000000002",
  voice: "100000000000000003",
  text: "100000000000000004",
  user: "100000000000000005"
};

const target = {
  deployment_id: "test",
  guild_id: ids.allowedGuild,
  voice_channel_id: ids.voice,
  text_channel_id: ids.text,
  authorized_by_user_id: ids.actor,
  authorized_at: 1
};

function command(overrides: Partial<UnsignedCommandEnvelope> = {}): CommandEnvelope {
  return { ...commandFixture(overrides), mac: "a".repeat(43) };
}

function channel(id: string, type = 2): RpcChannel {
  return { id, guild_id: ids.allowedGuild, name: "target", type };
}

function harness() {
  let disconnectHandler: ((code: string) => void) | null = null;
  let selectionHandler:
    ((selection: { channel_id: string | null; guild_id: string | null }) => void) | null = null;
  const rpc = {
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    authenticate: vi
      .fn()
      .mockResolvedValue({ userId: ids.user, scopes: ["rpc"], expires: "later" }),
    getSelectedVoiceChannel: vi.fn().mockResolvedValue(null),
    selectVoiceChannel: vi.fn().mockResolvedValue(channel(ids.voice)),
    selectTextChannel: vi.fn().mockResolvedValue(channel(ids.text, 0)),
    onDisconnect: vi.fn().mockImplementation((handler) => {
      disconnectHandler = handler;
      return () => undefined;
    }),
    subscribeVoiceSelection: vi.fn().mockImplementation((handler) => {
      selectionHandler = handler;
      return Promise.resolve(() => undefined);
    })
  } satisfies Pick<
    DiscordRpcSession,
    | "authenticate"
    | "close"
    | "connect"
    | "getSelectedVoiceChannel"
    | "onDisconnect"
    | "selectTextChannel"
    | "selectVoiceChannel"
    | "subscribeVoiceSelection"
  >;
  const draftHandoff = { stage: vi.fn().mockResolvedValue(undefined) };
  const onStatus = vi.fn();
  const controller = new UserRpcController({
    allowedGuildId: ids.allowedGuild,
    deploymentId: "test",
    draftHandoff,
    onStatus,
    rpc
  });
  return {
    controller,
    disconnect: () => disconnectHandler,
    draftHandoff,
    onStatus,
    rpc,
    selection: () => selectionHandler
  };
}

describe("authorized local user RPC controller", () => {
  it("binds the expected user and joins only the exact authorized target", async () => {
    const { controller, rpc } = harness();
    await controller.initialize("oauth-access-token", ids.user);
    await controller.setTarget(target);
    const receipt = await controller.execute(command({ action: "join" }));
    expect(receipt).toMatchObject({ accepted: true, result_code: "OK" });
    expect(rpc.selectVoiceChannel).toHaveBeenCalledWith(ids.voice, { navigate: false });
    expect(controller.status).toMatchObject({
      agent_kind: "authorized_local_rpc",
      gateway_connected: false,
      voice_connected: true,
      udp_established: false,
      dave_established: false
    });
  });

  it("rejects a different signed-in Discord user", async () => {
    const { controller, rpc } = harness();
    await expect(controller.initialize("oauth-access-token", "100000000000000099")).rejects.toThrow(
      "RPC_AUTHORIZED_USER_MISMATCH"
    );
    expect(rpc.close).toHaveBeenCalledOnce();
    expect(controller.status.observed_state).toBe("BLOCKED");
  });

  it("stages a sanitized local draft but does not claim it sent a user message", async () => {
    const { controller, draftHandoff, rpc } = harness();
    await controller.initialize("oauth-access-token", ids.user);
    await controller.setTarget(target);
    await controller.execute(command({ action: "join" }));
    const receipt = await controller.execute(
      command({ action: "relay", payload: { text: "review this message" } })
    );
    expect(receipt).toMatchObject({
      accepted: true,
      result_code: "USER_SEND_REQUIRED",
      summary: expect.stringContaining("no message was sent")
    });
    expect(rpc.selectTextChannel).toHaveBeenCalledWith(ids.text);
    expect(draftHandoff.stage).toHaveBeenCalledWith("review this message");
  });

  it("blocks an unexpected disconnect instead of auto-rejoining", async () => {
    const { controller, rpc, selection } = harness();
    await controller.initialize("oauth-access-token", ids.user);
    await controller.setTarget(target);
    await controller.execute(command({ action: "join" }));
    selection()?.({ channel_id: null, guild_id: null });
    expect(controller.status).toMatchObject({
      observed_state: "BLOCKED",
      desired_connected: false,
      last_error_code: "RPC_UNEXPECTED_VOICE_DISCONNECT"
    });
    expect(rpc.selectVoiceChannel).toHaveBeenCalledTimes(1);
  });

  it("blocks when the authorized desktop RPC pipe closes", async () => {
    const { controller, disconnect } = harness();
    await controller.initialize("oauth-access-token", ids.user);
    await controller.setTarget(target);
    await controller.execute(command({ action: "join" }));
    disconnect()?.("DISCORD_RPC_PIPE_CLOSED");
    expect(controller.status).toMatchObject({
      observed_state: "BLOCKED",
      local_rpc_connected: false,
      voice_connected: false,
      last_error_code: "DISCORD_RPC_PIPE_CLOSED"
    });
  });

  it("rejects targets outside the profile's allowed server", async () => {
    const { controller } = harness();
    await controller.initialize("oauth-access-token", ids.user);
    await expect(
      controller.setTarget({ ...target, guild_id: "100000000000000099" })
    ).rejects.toThrow("RPC_TARGET_GUILD_NOT_ALLOWED");
  });
});
