import {
  ChannelType,
  Collection,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type VoiceChannel
} from "discord.js";
import { describe, expect, it, vi } from "vitest";

import type { AgentBootstrap, ManagedRoomRecord } from "@discord-vc-control/contracts";

import { ManagedRoomService } from "./managed-rooms.js";

const guildId = "100000000000000001";
const channelId = "100000000000000002";
const ownerId = "100000000000000003";
const targetId = "100000000000000004";
const staffOverwriteId = "100000000000000099";

function fixture(ownerPresent = true) {
  const events: unknown[] = [];
  const overwriteEdit = vi.fn().mockResolvedValue(undefined);
  const setName = vi.fn().mockResolvedValue(undefined);
  const setUserLimit = vi.fn().mockResolvedValue(undefined);
  const deleteChannel = vi.fn().mockResolvedValue(undefined);
  const disconnect = vi.fn().mockResolvedValue(undefined);
  const members = new Collection<string, GuildMember>();
  const guild = {
    id: guildId,
    roles: { everyone: { id: guildId } },
    members: { fetch: vi.fn() },
    channels: { cache: new Collection(), fetch: vi.fn() }
  };
  const channel = {
    id: channelId,
    guildId,
    type: ChannelType.GuildVoice,
    guild,
    members,
    permissionOverwrites: { edit: overwriteEdit },
    setName,
    setUserLimit,
    delete: deleteChannel
  } as unknown as VoiceChannel;
  const owner = {
    id: ownerId,
    displayName: "Owner",
    permissions: { has: vi.fn().mockReturnValue(false) },
    user: { bot: false },
    voice: { channel }
  } as unknown as GuildMember;
  const target = {
    id: targetId,
    displayName: "Target",
    permissions: { has: vi.fn().mockReturnValue(false) },
    user: { bot: false },
    voice: { channel, disconnect }
  } as unknown as GuildMember;
  if (ownerPresent) members.set(ownerId, owner);
  members.set(targetId, target);
  (guild.members.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(owner);
  (guild.channels.cache as Collection<string, unknown>).set(channelId, channel);
  (guild.channels.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(channel);

  const room: ManagedRoomRecord = {
    channel_id: channelId,
    deployment_id: "test",
    guild_id: guildId,
    owner_user_id: ownerId,
    category_id: "100000000000000005",
    settings: {
      name: "Owner's room",
      user_limit: 0,
      locked: false,
      permitted_user_ids: [],
      banned_user_ids: []
    }
  };
  const bootstrap: AgentBootstrap = {
    type: "bootstrap",
    deployment_id: "test",
    tenant_id: "test",
    desired_connected: false,
    paused: false,
    authorized_target: null,
    guild_configs: [
      {
        deployment_id: "test",
        guild_id: guildId,
        feature_profile: "managed_rooms",
        managed_rooms_enabled: true,
        prefix_commands_enabled: true,
        category_id: "100000000000000005",
        lobby_channel_id: "100000000000000006",
        command_channel_id: "100000000000000007"
      }
    ],
    managed_rooms: [room]
  };
  const service = new ManagedRoomService({
    deploymentId: "test",
    managedGuildIds: new Set([guildId]),
    managedRoomsEnabled: true,
    onEvent: (event) => events.push(event),
    prefixCommandsEnabled: true,
    targetApproverUserIds: new Set()
  });
  service.applyBootstrap(bootstrap);
  return {
    bootstrap,
    channel,
    deleteChannel,
    disconnect,
    events,
    guild,
    members,
    overwriteEdit,
    owner,
    room,
    service,
    setName,
    setUserLimit,
    target
  };
}

describe("managed room commands", () => {
  it("reuses an existing setup and toggles managed-room service idempotently", async () => {
    const { events, guild, owner, service } = fixture();
    (owner.permissions.has as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const create = vi.fn();
    (guild.channels as typeof guild.channels & { create: typeof create }).create = create;
    (guild.channels.cache as Collection<string, unknown>).set("100000000000000005", {
      id: "100000000000000005",
      type: ChannelType.GuildCategory
    });
    (guild.channels.cache as Collection<string, unknown>).set("100000000000000006", {
      id: "100000000000000006",
      type: ChannelType.GuildVoice
    });
    (guild.channels.cache as Collection<string, unknown>).set("100000000000000007", {
      id: "100000000000000007",
      type: ChannelType.GuildText
    });

    const configured = await service.setup(guild as unknown as Guild, owner);
    expect(configured).toMatchObject({
      category_id: "100000000000000005",
      lobby_channel_id: "100000000000000006",
      command_channel_id: "100000000000000007"
    });
    expect(create).not.toHaveBeenCalled();
    expect(service.setEnabled(guild as unknown as Guild, owner, true).managed_rooms_enabled).toBe(
      true
    );
    expect(service.setEnabled(guild as unknown as Guild, owner, false).managed_rooms_enabled).toBe(
      false
    );
    expect(
      events.filter((event) => (event as { type?: string }).type === "guild_config_event")
    ).toHaveLength(3);
  });

  it("requires an approved administrator for exact target authorization", () => {
    const denied = fixture();
    expect(() =>
      denied.service.authorizeTarget(denied.guild as unknown as Guild, denied.owner, denied.channel)
    ).toThrow("TARGET_APPROVER_REQUIRED");

    const allowed = fixture();
    (allowed.owner.permissions.has as ReturnType<typeof vi.fn>).mockReturnValue(true);
    allowed.service.authorizeTarget(
      allowed.guild as unknown as Guild,
      allowed.owner,
      allowed.channel
    );
    expect(allowed.events.at(-1)).toMatchObject({
      type: "authorized_target_event",
      target: {
        guild_id: guildId,
        voice_channel_id: channelId,
        text_channel_id: channelId,
        authorized_by_user_id: ownerId
      }
    });
  });

  it("accepts an exact target approver without granting managed-room administration", () => {
    const { bootstrap, channel, guild, owner } = fixture();
    const events: unknown[] = [];
    const service = new ManagedRoomService({
      deploymentId: "test",
      managedGuildIds: new Set([guildId]),
      managedRoomsEnabled: true,
      onEvent: (event) => events.push(event),
      prefixCommandsEnabled: true,
      targetApproverUserIds: new Set([ownerId])
    });
    service.applyBootstrap(bootstrap);

    expect(owner.permissions.has(PermissionFlagsBits.ManageChannels)).toBe(false);
    expect(owner.permissions.has(PermissionFlagsBits.ManageGuild)).toBe(false);
    service.authorizeTarget(guild as unknown as Guild, owner, channel);
    expect(events.at(-1)).toMatchObject({
      type: "authorized_target_event",
      target: { authorized_by_user_id: ownerId, voice_channel_id: channelId }
    });
  });

  it("records a new authorized target guild as presence-only", () => {
    const { bootstrap, channel, guild, owner } = fixture();
    const events: unknown[] = [];
    const service = new ManagedRoomService({
      deploymentId: "test",
      managedGuildIds: new Set(),
      managedRoomsEnabled: true,
      onEvent: (event) => events.push(event),
      prefixCommandsEnabled: true,
      targetApproverUserIds: new Set()
    });
    (owner.permissions.has as ReturnType<typeof vi.fn>).mockReturnValue(true);
    service.applyBootstrap({
      ...bootstrap,
      guild_configs: [],
      managed_rooms: []
    });
    service.authorizeTarget(guild as unknown as Guild, owner, channel);
    expect(events.slice(-2)).toMatchObject([
      {
        type: "guild_config_event",
        config: {
          feature_profile: "presence_only",
          managed_rooms_enabled: false,
          prefix_commands_enabled: false
        }
      },
      { type: "authorized_target_event" }
    ]);
    expect(service.status(guildId)).toContain("Profile: presence_only");
  });

  it("fences setup and enablement when managed rooms are not available", async () => {
    const { bootstrap, guild, owner } = fixture();
    (owner.permissions.has as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const disabled = new ManagedRoomService({
      deploymentId: "test",
      managedGuildIds: new Set([guildId]),
      managedRoomsEnabled: false,
      onEvent: vi.fn(),
      prefixCommandsEnabled: false,
      targetApproverUserIds: new Set()
    });
    disabled.applyBootstrap(bootstrap);
    await expect(disabled.setup(guild as unknown as Guild, owner)).rejects.toThrow(
      "MANAGED_ROOMS_DISABLED_BY_DEPLOYMENT"
    );
    expect(() => disabled.setEnabled(guild as unknown as Guild, owner, true)).toThrow(
      "MANAGED_ROOMS_DISABLED_BY_DEPLOYMENT"
    );

    const unauthorizedGuild = new ManagedRoomService({
      deploymentId: "test",
      managedGuildIds: new Set(),
      managedRoomsEnabled: true,
      onEvent: vi.fn(),
      prefixCommandsEnabled: false,
      targetApproverUserIds: new Set()
    });
    unauthorizedGuild.applyBootstrap(bootstrap);
    await expect(unauthorizedGuild.setup(guild as unknown as Guild, owner)).rejects.toThrow(
      "MANAGED_GUILD_NOT_AUTHORIZED"
    );
    expect(() => unauthorizedGuild.setEnabled(guild as unknown as Guild, owner, true)).toThrow(
      "MANAGED_GUILD_NOT_AUTHORIZED"
    );

    const presenceOnly = new ManagedRoomService({
      deploymentId: "test",
      managedGuildIds: new Set([guildId]),
      managedRoomsEnabled: true,
      onEvent: vi.fn(),
      prefixCommandsEnabled: false,
      targetApproverUserIds: new Set()
    });
    const managedConfig = bootstrap.guild_configs[0];
    if (managedConfig === undefined) throw new Error("TEST_MANAGED_CONFIG_MISSING");
    presenceOnly.applyBootstrap({
      ...bootstrap,
      guild_configs: [
        {
          ...managedConfig,
          feature_profile: "presence_only",
          managed_rooms_enabled: false,
          prefix_commands_enabled: false,
          category_id: null,
          lobby_channel_id: null,
          command_channel_id: null
        }
      ],
      managed_rooms: []
    });
    await expect(presenceOnly.setup(guild as unknown as Guild, owner)).rejects.toThrow(
      "PRESENCE_ONLY_PROFILE"
    );
    expect(() => presenceOnly.setEnabled(guild as unknown as Guild, owner, true)).toThrow(
      "PRESENCE_ONLY_PROFILE"
    );
  });

  it("reports room information", async () => {
    const { owner, service } = fixture();
    await expect(service.execute({ member: owner, subcommand: "info" })).resolves.toContain(
      "Size: unlimited"
    );
  });

  it("renames and resizes a room", async () => {
    const { owner, service, setName, setUserLimit } = fixture();
    await service.execute({ member: owner, subcommand: "name", argument: "Night Shift" });
    await service.execute({ member: owner, subcommand: "size", argument: "12" });
    expect(setName).toHaveBeenCalledWith("Night Shift", expect.any(String));
    expect(setUserLimit).toHaveBeenCalledWith(12, expect.any(String));
  });

  it("locks, unlocks, permits, and unpermits with channel-only ACLs", async () => {
    const { owner, overwriteEdit, service } = fixture();
    await service.execute({ member: owner, subcommand: "lock" });
    await service.execute({ member: owner, subcommand: "unlock" });
    await service.execute({ member: owner, subcommand: "permit", userId: targetId });
    await service.execute({ member: owner, subcommand: "unpermit", userId: targetId });
    expect(overwriteEdit).toHaveBeenCalledWith(guildId, { Connect: false });
    expect(overwriteEdit).toHaveBeenCalledWith(guildId, { Connect: null });
    expect(overwriteEdit).toHaveBeenCalledWith(targetId, { Connect: true });
    expect(overwriteEdit).toHaveBeenCalledWith(targetId, { Connect: null });
  });

  it("disconnects a room member without guild kick or ban", async () => {
    const { disconnect, owner, service } = fixture();
    await service.execute({ member: owner, subcommand: "kick", userId: targetId });
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("applies and removes a channel Connect ban", async () => {
    const { disconnect, owner, overwriteEdit, service } = fixture();
    await service.execute({ member: owner, subcommand: "ban", userId: targetId });
    await service.execute({ member: owner, subcommand: "unban", userId: targetId });
    expect(overwriteEdit).toHaveBeenCalledWith(targetId, { Connect: false });
    expect(overwriteEdit).toHaveBeenCalledWith(targetId, { Connect: null });
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("rejects ACL additions beyond the stored per-list cap before editing Discord", async () => {
    const permitted = fixture();
    permitted.room.settings.permitted_user_ids = Array.from({ length: 100 }, (_, index) =>
      String(200000000000000000n + BigInt(index))
    );
    await expect(
      permitted.service.execute({
        member: permitted.owner,
        subcommand: "permit",
        userId: targetId
      })
    ).rejects.toThrow("PERMITTED_USER_LIMIT_REACHED");
    expect(permitted.overwriteEdit).not.toHaveBeenCalled();

    const banned = fixture();
    banned.room.settings.banned_user_ids = Array.from({ length: 100 }, (_, index) =>
      String(300000000000000000n + BigInt(index))
    );
    await expect(
      banned.service.execute({ member: banned.owner, subcommand: "ban", userId: targetId })
    ).rejects.toThrow("BANNED_USER_LIMIT_REACHED");
    expect(banned.overwriteEdit).not.toHaveBeenCalled();
  });

  it("claims only when the prior owner is absent", async () => {
    const present = fixture(true);
    await expect(
      present.service.execute({ member: present.target, subcommand: "claim" })
    ).rejects.toThrow("CURRENT_OWNER_IS_PRESENT");
    const absent = fixture(false);
    await expect(
      absent.service.execute({ member: absent.target, subcommand: "claim" })
    ).resolves.toContain(`Owner: <@${targetId}>`);
  });

  it("resets only bot-owned Connect overwrites and preserves unrelated staff entries", async () => {
    const { owner, overwriteEdit, service } = fixture();
    await service.execute({ member: owner, subcommand: "permit", userId: targetId });
    overwriteEdit.mockClear();
    await service.execute({ member: owner, subcommand: "reset" });
    expect(overwriteEdit).toHaveBeenCalledWith(targetId, { Connect: null });
    expect(overwriteEdit).toHaveBeenCalledWith(guildId, { Connect: null });
    expect(overwriteEdit).toHaveBeenCalledWith(ownerId, {
      Connect: true,
      ViewChannel: true
    });
    expect(overwriteEdit.mock.calls.some(([id]) => id === staffOverwriteId)).toBe(false);
  });

  it("rejects commands outside rooms created by this bot", async () => {
    const { owner, service } = fixture();
    (owner.voice as { channel: unknown }).channel = {
      id: "100000000000000088",
      type: ChannelType.GuildVoice
    };
    await expect(service.execute({ member: owner, subcommand: "info" })).rejects.toThrow(
      "ROOM_NOT_MANAGED_BY_THIS_BOT"
    );
  });

  it("rejects non-owner members and invalid room arguments", async () => {
    const { owner, service, target } = fixture();
    await expect(service.execute({ member: target, subcommand: "lock" })).rejects.toThrow(
      "ROOM_OWNER_OR_STAFF_REQUIRED"
    );
    await expect(
      service.execute({ member: owner, subcommand: "name", argument: "\u0000" })
    ).rejects.toThrow("NAME_MUST_BE_1_TO_100_CHARACTERS");
    await expect(
      service.execute({ member: owner, subcommand: "size", argument: "100" })
    ).rejects.toThrow("SIZE_MUST_BE_1_TO_99_OR_UNLIMITED");
    await expect(
      service.execute({ member: owner, subcommand: "kick", userId: owner.id })
    ).rejects.toThrow("VALID_OTHER_USER_REQUIRED");
  });

  it("deletes after 15 seconds when only bots remain", async () => {
    vi.useFakeTimers();
    const { deleteChannel, members, owner, service } = fixture();
    members.clear();
    members.set("100000000000000010", { user: { bot: true } } as unknown as GuildMember);
    const oldState = {
      channelId,
      guild: owner.guild ?? (owner.voice.channel as VoiceChannel).guild,
      member: owner
    };
    const newState = { channelId: null, guild: oldState.guild, member: owner };
    await service.handleVoiceState(oldState as never, newState as never);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(deleteChannel).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("schedules bot-only room cleanup during restart reconciliation", async () => {
    vi.useFakeTimers();
    const { deleteChannel, guild, members, service } = fixture();
    members.clear();
    members.set("100000000000000010", { user: { bot: true } } as unknown as GuildMember);
    await service.reconcileGuild(guild as unknown as Guild);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(deleteChannel).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("cancels deletion when a human rejoins during the grace period", async () => {
    vi.useFakeTimers();
    const { deleteChannel, members, owner, service, target } = fixture();
    members.clear();
    members.set("100000000000000010", { user: { bot: true } } as unknown as GuildMember);
    const guild = owner.guild ?? (owner.voice.channel as VoiceChannel).guild;
    await service.handleVoiceState(
      { channelId, guild, member: owner } as never,
      { channelId: null, guild, member: owner } as never
    );
    members.set(target.id, target);
    await service.handleVoiceState(
      { channelId: null, guild, member: target } as never,
      { channelId, guild, member: target } as never
    );
    await vi.advanceTimersByTimeAsync(15_000);
    expect(deleteChannel).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
