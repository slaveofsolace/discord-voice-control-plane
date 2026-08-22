import { EventEmitter } from "node:events";

import {
  VoiceConnectionStatus,
  type VoiceConnection,
  type VoiceConnectionState
} from "@discordjs/voice";
import { ChannelType, type Client, type VoiceState } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AuthorizedTarget,
  CommandEnvelope,
  ControlAction
} from "@discord-vc-control/contracts";

import { VoiceController } from "./voice-controller.js";

const voiceMocks = vi.hoisted(() => ({
  entersState: vi.fn(),
  joinVoiceChannel: vi.fn()
}));

vi.mock("@discordjs/voice", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    entersState: voiceMocks.entersState,
    joinVoiceChannel: voiceMocks.joinVoiceChannel
  };
});

const target: AuthorizedTarget = {
  deployment_id: "test",
  guild_id: "100000000000000001",
  voice_channel_id: "100000000000000002",
  text_channel_id: "100000000000000003",
  authorized_by_user_id: "100000000000000004",
  authorized_at: 1
};

function command(
  action: ControlAction,
  payload: Record<string, unknown> = {},
  actorUserId = "100000000000000004"
): CommandEnvelope {
  const now = Date.now();
  return {
    version: 1,
    command_id: crypto.randomUUID(),
    issued_at: now,
    expires_at: now + 30_000,
    nonce: crypto.randomUUID(),
    actor_user_id: actorUserId,
    control_guild_id: "100000000000000005",
    control_channel_id: "100000000000000006",
    deployment_id: "test",
    tenant_id: "test",
    action,
    payload,
    kid: "v1",
    mac: "x".repeat(43)
  };
}

function connectionFixture(daveEstablished = true): {
  connection: VoiceConnection;
  destroy: ReturnType<typeof vi.fn>;
  emitter: EventEmitter;
} {
  const emitter = new EventEmitter();
  const mutable = emitter as EventEmitter & {
    destroy: () => void;
    ping: { udp: number; ws: number };
    state: { status: VoiceConnectionStatus };
    voicePrivacyCode: string | undefined;
  };
  mutable.state = { status: VoiceConnectionStatus.Ready };
  mutable.voicePrivacyCode = daveEstablished ? "privacy-code" : undefined;
  mutable.ping = { udp: 8, ws: 5 };
  const destroy = vi.fn(() => {
    mutable.state = { status: VoiceConnectionStatus.Destroyed };
  });
  mutable.destroy = destroy;
  return { connection: mutable as unknown as VoiceConnection, destroy, emitter };
}

function fixture(permissionAllowed = true, daveEstablished = true) {
  const voiceConnection = connectionFixture(daveEstablished);
  voiceMocks.joinVoiceChannel.mockReturnValue(voiceConnection.connection);
  voiceMocks.entersState.mockResolvedValue(voiceConnection.connection);
  const send = vi.fn().mockResolvedValue({ id: "100000000000000099" });
  const voiceChannel = {
    id: target.voice_channel_id,
    type: ChannelType.GuildVoice,
    permissionsFor: vi.fn().mockReturnValue({ has: vi.fn().mockReturnValue(permissionAllowed) })
  };
  const textChannel = { isTextBased: () => true, send };
  const guild = {
    id: target.guild_id,
    voiceAdapterCreator: vi.fn(),
    channels: {
      fetch: vi.fn((id: string) =>
        Promise.resolve(id === target.voice_channel_id ? voiceChannel : textChannel)
      )
    },
    members: { me: { id: "100000000000000098" }, fetchMe: vi.fn() }
  };
  const client = {
    isReady: () => true,
    guilds: { fetch: vi.fn().mockResolvedValue(guild) }
  } as unknown as Client;
  const statuses: unknown[] = [];
  const controller = new VoiceController({
    client,
    deploymentId: "test",
    onStatus: (status) => statuses.push(status)
  });
  controller.setTarget(target);
  return { controller, send, statuses, voiceConnection };
}

beforeEach(() => {
  voiceMocks.entersState.mockReset();
  voiceMocks.joinVoiceChannel.mockReset();
});

describe("voice controller", () => {
  it("joins only the authorized target, silent and DAVE-enabled", async () => {
    const { controller } = fixture();
    await expect(controller.execute(command("join"))).resolves.toMatchObject({
      accepted: true,
      observed_state: "CONNECTED"
    });
    expect(voiceMocks.joinVoiceChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: target.voice_channel_id,
        guildId: target.guild_id,
        daveEncryption: true,
        selfDeaf: true,
        selfMute: true
      })
    );
    expect(controller.status).toMatchObject({
      voice_connected: true,
      udp_established: true,
      dave_established: true
    });
  });

  it("returns live, redacted diagnostics from the voice process", async () => {
    const { controller } = fixture();
    await controller.execute(command("join"));
    await expect(controller.execute(command("diagnostics"))).resolves.toMatchObject({
      accepted: true,
      summary: expect.stringContaining("ws_ping_ms=5")
    });
  });

  it("relays normalized plain text with mention suppression and operator limits", async () => {
    const { controller, send } = fixture();
    await controller.execute(command("join"));
    const first = await controller.execute(command("relay", { text: " cafe\u0301 " }));
    expect(first).toMatchObject({ accepted: true, target_message_id: "100000000000000099" });
    expect(send).toHaveBeenCalledWith({
      content: "café",
      allowedMentions: { parse: [] },
      nonce: first.command_id?.replaceAll("-", "").slice(0, 25),
      enforceNonce: true
    });
    for (let index = 0; index < 4; index += 1) {
      expect(
        (await controller.execute(command("relay", { text: `message ${index}` }))).accepted
      ).toBe(true);
    }
    await expect(
      controller.execute(command("relay", { text: "one too many" }))
    ).resolves.toMatchObject({
      accepted: false,
      result_code: "OPERATOR_RELAY_RATE_LIMIT"
    });
  });

  it("does not report connected until DAVE negotiation is observed", async () => {
    const { controller, voiceConnection } = fixture(true, false);
    const pending = controller.execute(command("join"));
    await vi.waitFor(() => expect(controller.status.observed_state).toBe("DEGRADED"));
    voiceConnection.emitter.emit("transitioned");
    await expect(pending).resolves.toMatchObject({ accepted: true, observed_state: "CONNECTED" });
    expect(controller.status.dave_established).toBe(true);
  });

  it("enforces the deployment-wide relay limit across distinct operators", async () => {
    const { controller, send } = fixture();
    await controller.execute(command("join"));
    for (let index = 0; index < 20; index += 1) {
      const actor = String(100000000000000000n + BigInt(index));
      expect(
        (await controller.execute(command("relay", { text: `message ${index}` }, actor))).accepted
      ).toBe(true);
    }
    const rejected = await controller.execute(
      command("relay", { text: "deployment overflow" }, "100000000000000099")
    );
    expect(rejected).toMatchObject({
      accepted: false,
      result_code: "DEPLOYMENT_RELAY_RATE_LIMIT"
    });
    expect(send).toHaveBeenCalledTimes(20);
  });

  it("fails closed on a Discord relay rate-limit response without retrying", async () => {
    const { controller, send } = fixture();
    await controller.execute(command("join"));
    send.mockRejectedValueOnce(new Error("DISCORD_429"));
    await expect(
      controller.execute(command("relay", { text: "ordinary message" }))
    ).resolves.toMatchObject({
      accepted: false,
      result_code: "DISCORD_429"
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it("blocks permission loss, moderator removal, target deletion, and target changes", async () => {
    const denied = fixture(false);
    await expect(denied.controller.execute(command("join"))).resolves.toMatchObject({
      accepted: false,
      result_code: "VOICE_PERMISSION_LOST",
      observed_state: "BLOCKED"
    });

    const removed = fixture();
    await removed.controller.execute(command("join"));
    removed.controller.handleOwnVoiceState(
      { channelId: target.voice_channel_id } as VoiceState,
      { channelId: null } as VoiceState
    );
    expect(removed.controller.status).toMatchObject({
      observed_state: "BLOCKED",
      desired_connected: false,
      last_error_code: "MODERATOR_DISCONNECT"
    });

    const deleted = fixture();
    await deleted.controller.execute(command("join"));
    deleted.controller.handleChannelDelete(target.voice_channel_id);
    expect(deleted.controller.status.observed_state).toBe("BLOCKED");

    const changed = fixture();
    await changed.controller.execute(command("join"));
    changed.controller.setTarget({ ...target, voice_channel_id: "100000000000000088" });
    expect(changed.controller.status).toMatchObject({
      observed_state: "BLOCKED",
      last_error_code: "AUTHORIZATION_CHANGED"
    });

    const controlAuth = fixture();
    await controlAuth.controller.execute(command("join"));
    controlAuth.controller.handleControlPlaneFailure("AGENT_AUTH_REJECTED");
    expect(controlAuth.controller.status).toMatchObject({
      observed_state: "BLOCKED",
      last_error_code: "AGENT_AUTH_REJECTED"
    });
  });

  it("blocks a join when no exact target is authorized", async () => {
    const { controller } = fixture();
    controller.setTarget(null);
    await expect(controller.execute(command("join"))).resolves.toMatchObject({
      accepted: false,
      result_code: "AUTHORIZED_TARGET_NOT_SET",
      observed_state: "BLOCKED"
    });
  });

  it("distinguishes operator disconnects from later moderator removal", async () => {
    const paused = fixture();
    await paused.controller.execute(command("join"));
    await paused.controller.execute(command("pause"));
    paused.controller.handleOwnVoiceState(
      { channelId: target.voice_channel_id } as VoiceState,
      { channelId: null } as VoiceState
    );
    expect(paused.controller.status.observed_state).toBe("PAUSED");

    const reconnected = fixture();
    const replacement = connectionFixture();
    voiceMocks.joinVoiceChannel
      .mockReturnValueOnce(reconnected.voiceConnection.connection)
      .mockReturnValueOnce(replacement.connection);
    await reconnected.controller.execute(command("join"));
    const reconnect = reconnected.controller.execute(command("reconnect"));
    reconnected.controller.handleOwnVoiceState(
      { channelId: target.voice_channel_id } as VoiceState,
      { channelId: null } as VoiceState
    );
    await expect(reconnect).resolves.toMatchObject({ accepted: true, observed_state: "CONNECTED" });
    reconnected.controller.handleOwnVoiceState(
      { channelId: target.voice_channel_id } as VoiceState,
      { channelId: null } as VoiceState
    );
    expect(reconnected.controller.status).toMatchObject({
      observed_state: "BLOCKED",
      last_error_code: "MODERATOR_DISCONNECT"
    });
  });

  it("blocks repeated DAVE failures and never reconnects after intentional leave", async () => {
    vi.useFakeTimers();
    const dave = fixture();
    await dave.controller.execute(command("join"));
    dave.voiceConnection.emitter.emit("error", new Error("DAVE negotiation failed"));
    expect(dave.controller.status.observed_state).toBe("BACKING_OFF");
    dave.voiceConnection.emitter.emit("error", new Error("DAVE negotiation failed again"));
    expect(dave.controller.status).toMatchObject({
      observed_state: "BLOCKED",
      last_error_code: "DAVE_NEGOTIATION_FAILED"
    });
    vi.useRealTimers();

    const left = fixture();
    await left.controller.execute(command("join"));
    await left.controller.execute(command("leave"));
    left.controller.handleOwnVoiceState(
      { channelId: target.voice_channel_id } as VoiceState,
      { channelId: null } as VoiceState
    );
    expect(left.controller.status).toMatchObject({
      observed_state: "DISABLED",
      desired_connected: false
    });
  });

  it("blocks a Discord voice close code that forbids reconnect", async () => {
    const { controller, voiceConnection } = fixture();
    await controller.execute(command("join"));
    voiceConnection.emitter.emit(
      "stateChange",
      { status: VoiceConnectionStatus.Ready } as VoiceConnectionState,
      {
        status: VoiceConnectionStatus.Disconnected,
        reason: 0,
        closeCode: 4014
      } as VoiceConnectionState
    );
    expect(controller.status).toMatchObject({
      observed_state: "BLOCKED",
      last_error_code: "VOICE_CLOSE_4014"
    });
  });
});
