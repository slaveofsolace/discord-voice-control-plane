import { describe, expect, it, vi } from "vitest";

import { commandFixture } from "@discord-vc-control/testing";
import {
  type CommandEnvelope,
  type RelayRequest,
  type UnsignedCommandEnvelope
} from "@discord-vc-control/contracts";

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

function pendingRelay(): RelayRequest {
  return {
    request_id: "00000000-0000-5000-8000-000000000001",
    command_id: "00000000-0000-5000-8000-000000000001",
    deployment_id: "test",
    tenant_id: "test",
    profile_name: "main",
    source_application_id: "100000000000000010",
    source_message_id: "100000000000000011",
    actor_user_id: ids.actor,
    actor_role_ids: [],
    control_guild_id: "100000000000000012",
    control_channel_id: "100000000000000013",
    target_guild_id: ids.allowedGuild,
    target_voice_channel_id: ids.voice,
    target_text_channel_id: ids.text,
    content_kind: "ordinary_chat",
    risk: "OPERATOR",
    parsed_command: null,
    content: "manual draft",
    status: "PENDING_USER_APPROVAL",
    result_code: "PENDING_USER_APPROVAL",
    created_at: Date.now(),
    updated_at: Date.now(),
    expires_at: Date.now() + 30 * 60_000
  };
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
  const relayQueue = {
    enqueue: vi.fn().mockImplementation(async (request) => ({
      ...request,
      status: "PENDING_USER_APPROVAL",
      result_code: "PENDING_USER_APPROVAL"
    })),
    expire: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    invalidateContext: vi.fn().mockResolvedValue(0),
    list: vi.fn().mockResolvedValue([]),
    transition: vi.fn()
  };
  const onStatus = vi.fn();
  const controller = new UserRpcController({
    allowedGuildId: ids.allowedGuild,
    deploymentId: "test",
    draftHandoff,
    profileName: "main",
    relayQueue,
    onStatus,
    rpc
  });
  return {
    controller,
    disconnect: () => disconnectHandler,
    draftHandoff,
    onStatus,
    rpc,
    relayQueue,
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

  it("queues an encrypted local approval request without selecting text or touching the clipboard", async () => {
    const { controller, draftHandoff, relayQueue, rpc } = harness();
    await controller.initialize("oauth-access-token", ids.user);
    await controller.setTarget(target);
    await controller.execute(command({ action: "join" }));
    const receipt = await controller.execute(
      command({ action: "relay", payload: { text: "review this message" } })
    );
    expect(receipt).toMatchObject({
      accepted: true,
      result_code: "PENDING_USER_APPROVAL",
      summary: expect.stringContaining("waiting for the account owner")
    });
    expect(relayQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ content: "review this message", profile_name: "main" })
    );
    expect(rpc.selectTextChannel).not.toHaveBeenCalled();
    expect(draftHandoff.stage).not.toHaveBeenCalled();
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

  it("prepares only after rechecking account, exact voice, exact text, and target", async () => {
    const { controller, draftHandoff, relayQueue, rpc } = harness();
    await controller.initialize("oauth-access-token", ids.user);
    await controller.setTarget(target);
    rpc.getSelectedVoiceChannel.mockResolvedValue(channel(ids.voice));
    relayQueue.get.mockResolvedValue(pendingRelay());
    relayQueue.transition.mockResolvedValue({
      ...pendingRelay(),
      status: "PREPARED_FOR_MANUAL_SEND",
      result_code: "PREPARED_FOR_MANUAL_SEND"
    });
    await expect(controller.prepareRelay(pendingRelay().request_id)).resolves.toMatchObject({
      status: "PREPARED_FOR_MANUAL_SEND"
    });
    expect(rpc.authenticate).toHaveBeenCalledTimes(2);
    expect(rpc.selectTextChannel).toHaveBeenCalledWith(ids.text);
    expect(draftHandoff.stage).toHaveBeenCalledWith("manual draft");
  });

  it("does not prepare for the wrong signed-in user or wrong selected voice", async () => {
    const { controller, draftHandoff, relayQueue, rpc } = harness();
    await controller.initialize("oauth-access-token", ids.user);
    await controller.setTarget(target);
    relayQueue.get.mockResolvedValue(pendingRelay());
    rpc.authenticate.mockResolvedValueOnce({
      userId: "100000000000000099",
      scopes: ["rpc"],
      expires: "later"
    });
    await expect(controller.prepareRelay(pendingRelay().request_id)).rejects.toThrow(
      "RPC_AUTHORIZED_USER_MISMATCH"
    );
    expect(draftHandoff.stage).not.toHaveBeenCalled();

    const second = harness();
    await second.controller.initialize("oauth-access-token", ids.user);
    await second.controller.setTarget(target);
    second.relayQueue.get.mockResolvedValue(pendingRelay());
    second.rpc.getSelectedVoiceChannel.mockResolvedValue(channel("100000000000000099"));
    await expect(second.controller.prepareRelay(pendingRelay().request_id)).rejects.toThrow(
      "RPC_VOICE_NOT_CONNECTED"
    );
    expect(second.draftHandoff.stage).not.toHaveBeenCalled();
  });

  it("invalidates all pending requests after target reauthorization", async () => {
    const { controller, relayQueue } = harness();
    await controller.initialize("oauth-access-token", ids.user);
    await controller.setTarget(target);
    await controller.setTarget({ ...target, authorized_at: 2 });
    expect(relayQueue.invalidateContext).toHaveBeenLastCalledWith(
      expect.objectContaining({ force: true })
    );
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
