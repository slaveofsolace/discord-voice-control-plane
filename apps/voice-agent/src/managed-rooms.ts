import {
  ChannelType,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type VoiceChannel,
  type VoiceState
} from "discord.js";

import {
  type AgentBootstrap,
  type AgentMessage,
  type GuildConfigRecord,
  type ManagedRoomRecord,
  type ManagedRoomSettings
} from "@discord-vc-control/contracts";

import type { ParsedPrefixCommand, VoiceSubcommand } from "./prefix.js";

const deletionGraceMs = 15_000;

export interface ManagedRoomServiceOptions {
  deploymentId: string;
  managedGuildIds: ReadonlySet<string>;
  managedRoomsEnabled: boolean;
  onEvent: (event: AgentMessage) => void;
  prefixCommandsEnabled: boolean;
  targetApproverUserIds: ReadonlySet<string>;
}

export interface RoomCommandInput {
  argument?: string;
  member: GuildMember;
  subcommand: VoiceSubcommand;
  userId?: string;
}

export class ManagedRoomService {
  readonly #configs = new Map<string, GuildConfigRecord>();
  readonly #deletionTimers = new Map<string, NodeJS.Timeout>();
  readonly #guildOperations = new Map<string, Promise<void>>();
  readonly #rooms = new Map<string, ManagedRoomRecord>();

  constructor(private readonly options: ManagedRoomServiceOptions) {}

  applyBootstrap(bootstrap: AgentBootstrap): void {
    for (const timer of this.#deletionTimers.values()) clearTimeout(timer);
    this.#deletionTimers.clear();
    this.#configs.clear();
    this.#rooms.clear();
    for (const config of bootstrap.guild_configs) this.#configs.set(config.guild_id, config);
    for (const room of bootstrap.managed_rooms) this.#rooms.set(room.channel_id, room);
  }

  prefixEnabledForGuild(guildId: string): boolean {
    return this.#configs.get(guildId)?.prefix_commands_enabled === true;
  }

  async setup(guild: Guild, actor: GuildMember): Promise<GuildConfigRecord> {
    return this.withGuildLock(guild.id, () => this.setupLocked(guild, actor));
  }

  private async setupLocked(guild: Guild, actor: GuildMember): Promise<GuildConfigRecord> {
    this.requireAdministrator(actor);
    if (!this.options.managedRoomsEnabled) {
      throw new Error("MANAGED_ROOMS_DISABLED_BY_DEPLOYMENT");
    }
    let config = this.#configs.get(guild.id);
    if (config?.feature_profile === "presence_only") throw new Error("PRESENCE_ONLY_PROFILE");
    if (!this.options.managedGuildIds.has(guild.id)) {
      throw new Error("MANAGED_GUILD_NOT_AUTHORIZED");
    }
    let category = config?.category_id ? guild.channels.cache.get(config.category_id) : undefined;
    category ??= guild.channels.cache.find(
      (channel) => channel.type === ChannelType.GuildCategory && channel.name === "Temporary Voice"
    );
    if (category?.type !== ChannelType.GuildCategory) {
      category = await guild.channels.create({
        name: "Temporary Voice",
        type: ChannelType.GuildCategory,
        reason: `Managed-room setup by ${actor.id}`
      });
    }
    let lobby = config?.lobby_channel_id
      ? guild.channels.cache.get(config.lobby_channel_id)
      : undefined;
    lobby ??= guild.channels.cache.find(
      (channel) => channel.type === ChannelType.GuildVoice && channel.name === "Join to Create"
    );
    if (lobby?.type !== ChannelType.GuildVoice) {
      lobby = await guild.channels.create({
        name: "Join to Create",
        type: ChannelType.GuildVoice,
        parent: category.id,
        reason: `Managed-room setup by ${actor.id}`
      });
    }
    let commandChannel = config?.command_channel_id
      ? guild.channels.cache.get(config.command_channel_id)
      : undefined;
    commandChannel ??= guild.channels.cache.find(
      (channel) => channel.type === ChannelType.GuildText && channel.name === "voice-control"
    );
    if (commandChannel?.type !== ChannelType.GuildText) {
      commandChannel = await guild.channels.create({
        name: "voice-control",
        type: ChannelType.GuildText,
        parent: category.id,
        reason: `Managed-room setup by ${actor.id}`
      });
    }
    config = {
      deployment_id: this.options.deploymentId,
      guild_id: guild.id,
      feature_profile: "managed_rooms",
      managed_rooms_enabled: config?.managed_rooms_enabled ?? false,
      prefix_commands_enabled: this.options.prefixCommandsEnabled,
      category_id: category.id,
      lobby_channel_id: lobby.id,
      command_channel_id: commandChannel.id
    };
    this.storeConfig(config);
    return config;
  }

  status(guildId: string): string {
    const config = this.#configs.get(guildId);
    if (config === undefined) return "Managed rooms are not configured.";
    const roomCount = [...this.#rooms.values()].filter((room) => room.guild_id === guildId).length;
    return [
      `Profile: ${config.feature_profile}`,
      `Enabled: ${config.managed_rooms_enabled ? "yes" : "no"}`,
      `Category: ${config.category_id ?? "missing"}`,
      `Lobby: ${config.lobby_channel_id ?? "missing"}`,
      `Command channel: ${config.command_channel_id ?? "missing"}`,
      `Managed rooms: ${roomCount}`,
      `Prefix commands: ${config.prefix_commands_enabled ? "enabled" : "disabled"}`
    ].join("\n");
  }

  async setEnabled(guild: Guild, actor: GuildMember, enabled: boolean): Promise<GuildConfigRecord> {
    return this.withGuildLock(guild.id, () => this.setEnabledLocked(guild, actor, enabled));
  }

  private setEnabledLocked(guild: Guild, actor: GuildMember, enabled: boolean): GuildConfigRecord {
    this.requireAdministrator(actor);
    const config = this.#configs.get(guild.id);
    if (config === undefined) throw new Error("RUN_VOICE_ADMIN_SETUP_FIRST");
    if (config.feature_profile !== "managed_rooms") throw new Error("PRESENCE_ONLY_PROFILE");
    if (!this.options.managedGuildIds.has(guild.id)) {
      throw new Error("MANAGED_GUILD_NOT_AUTHORIZED");
    }
    if (enabled && !this.options.managedRoomsEnabled) {
      throw new Error("MANAGED_ROOMS_DISABLED_BY_DEPLOYMENT");
    }
    const updated = { ...config, managed_rooms_enabled: enabled };
    this.storeConfig(updated);
    return updated;
  }

  authorizeTarget(guild: Guild, actor: GuildMember, channel: VoiceChannel): void {
    const permitted =
      this.options.targetApproverUserIds.has(actor.id) ||
      actor.permissions.has(PermissionFlagsBits.ManageGuild);
    if (!permitted) throw new Error("TARGET_APPROVER_REQUIRED");
    if (channel.guildId !== guild.id || channel.type !== ChannelType.GuildVoice) {
      throw new Error("GUILD_VOICE_CHANNEL_REQUIRED");
    }
    if (!this.#configs.has(guild.id)) {
      const managedProfile = this.options.managedGuildIds.has(guild.id);
      this.storeConfig({
        deployment_id: this.options.deploymentId,
        guild_id: guild.id,
        feature_profile: managedProfile ? "managed_rooms" : "presence_only",
        managed_rooms_enabled: false,
        prefix_commands_enabled: managedProfile && this.options.prefixCommandsEnabled,
        category_id: null,
        lobby_channel_id: null,
        command_channel_id: null
      });
    }
    this.options.onEvent({
      type: "authorized_target_event",
      target: {
        deployment_id: this.options.deploymentId,
        guild_id: guild.id,
        voice_channel_id: channel.id,
        text_channel_id: channel.id,
        authorized_by_user_id: actor.id,
        authorized_at: Date.now()
      }
    });
  }

  async handleVoiceState(oldState: VoiceState, newState: VoiceState): Promise<void> {
    const member = newState.member ?? oldState.member;
    if (member === null || member.user.bot) return;
    const config = this.#configs.get(newState.guild.id);
    if (
      newState.channelId !== null &&
      newState.channelId === config?.lobby_channel_id &&
      config.managed_rooms_enabled
    ) {
      await this.withGuildLock(newState.guild.id, async () => {
        const current = this.#configs.get(newState.guild.id);
        if (
          current?.feature_profile !== "managed_rooms" ||
          !current.managed_rooms_enabled ||
          !this.options.managedRoomsEnabled ||
          !this.options.managedGuildIds.has(newState.guild.id)
        ) {
          return;
        }
        await this.createOrReuseRoom(newState.guild, member, current);
      });
    }
    if (oldState.channelId !== null && this.#rooms.has(oldState.channelId)) {
      this.scheduleDeleteIfEmpty(oldState.channelId, oldState.guild);
    }
    if (newState.channelId !== null && this.#rooms.has(newState.channelId)) {
      const timer = this.#deletionTimers.get(newState.channelId);
      if (timer !== undefined) clearTimeout(timer);
      this.#deletionTimers.delete(newState.channelId);
    }
  }

  async reconcileGuild(guild: Guild): Promise<void> {
    const rooms = [...this.#rooms.values()].filter((room) => room.guild_id === guild.id);
    for (const room of rooms) {
      const channel = await guild.channels.fetch(room.channel_id).catch(() => null);
      if (channel?.type !== ChannelType.GuildVoice) {
        this.handleChannelDelete(room.channel_id, guild.id);
        continue;
      }
      this.scheduleDeleteIfEmpty(room.channel_id, guild, channel);
    }
  }

  handleChannelDelete(channelId: string, guildId: string): void {
    const room = this.#rooms.get(channelId);
    if (room === undefined) return;
    const timer = this.#deletionTimers.get(channelId);
    if (timer !== undefined) clearTimeout(timer);
    this.#deletionTimers.delete(channelId);
    this.#rooms.delete(channelId);
    this.options.onEvent({
      type: "managed_room_event",
      operation: "delete",
      deployment_id: this.options.deploymentId,
      channel_id: channelId,
      guild_id: guildId,
      occurred_at: Date.now()
    });
  }

  async executePrefix(member: GuildMember, command: ParsedPrefixCommand): Promise<string> {
    if ("userId" in command) {
      return this.execute({ member, subcommand: command.subcommand, userId: command.userId });
    }
    if ("argument" in command) {
      return this.execute({ member, subcommand: command.subcommand, argument: command.argument });
    }
    return this.execute({ member, subcommand: command.subcommand });
  }

  async execute(input: RoomCommandInput): Promise<string> {
    return this.withGuildLock(input.member.guild.id, () => this.executeLocked(input));
  }

  private async executeLocked(input: RoomCommandInput): Promise<string> {
    const channel = input.member.voice.channel;
    if (channel?.type !== ChannelType.GuildVoice)
      throw new Error("JOIN_A_MANAGED_VOICE_ROOM_FIRST");
    const room = this.#rooms.get(channel.id);
    if (room === undefined) throw new Error("ROOM_NOT_MANAGED_BY_THIS_BOT");
    const config = this.#configs.get(channel.guild.id);
    if (
      !this.options.managedRoomsEnabled ||
      !this.options.managedGuildIds.has(channel.guild.id) ||
      config?.feature_profile !== "managed_rooms" ||
      !config.managed_rooms_enabled
    ) {
      throw new Error("MANAGED_ROOMS_DISABLED");
    }
    const isStaff = input.member.permissions.has(PermissionFlagsBits.ManageChannels);
    if (input.subcommand !== "claim" && room.owner_user_id !== input.member.id && !isStaff) {
      throw new Error("ROOM_OWNER_OR_STAFF_REQUIRED");
    }
    switch (input.subcommand) {
      case "info":
        return this.describeRoom(room);
      case "name": {
        const name = this.validateName(input.argument ?? "");
        await channel.setName(name, `Room command by ${input.member.id}`);
        room.settings.name = name;
        break;
      }
      case "size": {
        const userLimit = this.parseUserLimit(input.argument ?? "");
        await channel.setUserLimit(userLimit, `Room command by ${input.member.id}`);
        room.settings.user_limit = userLimit;
        break;
      }
      case "lock":
        this.assertAclMatchesSettings(channel, room, channel.guild.roles.everyone.id, {
          connect: true
        });
        await channel.permissionOverwrites.edit(channel.guild.roles.everyone.id, {
          Connect: false
        });
        room.settings.locked = true;
        break;
      case "unlock":
        this.assertAclMatchesSettings(channel, room, channel.guild.roles.everyone.id, {
          connect: true
        });
        await channel.permissionOverwrites.edit(channel.guild.roles.everyone.id, { Connect: null });
        room.settings.locked = false;
        break;
      case "permit":
        await this.permit(channel, room, input.userId);
        break;
      case "unpermit":
        await this.unpermit(channel, room, input.userId);
        break;
      case "kick":
        await this.kick(channel, input.member, input.userId);
        return "User disconnected from this channel.";
      case "ban":
        await this.ban(channel, room, input.member, input.userId);
        break;
      case "unban":
        await this.unban(channel, room, input.userId);
        break;
      case "reset":
        await this.reset(channel, room);
        break;
      case "claim":
        await this.claim(channel, room, input.member);
        break;
    }
    this.storeRoom(room);
    return this.describeRoom(room);
  }

  private async createOrReuseRoom(
    guild: Guild,
    member: GuildMember,
    config: GuildConfigRecord
  ): Promise<void> {
    const existing = [...this.#rooms.values()].find(
      (room) => room.guild_id === guild.id && room.owner_user_id === member.id
    );
    if (existing !== undefined) {
      const channel = guild.channels.cache.get(existing.channel_id);
      if (channel?.type === ChannelType.GuildVoice) {
        await member.voice.setChannel(channel, "Reuse existing managed room");
        return;
      }
      this.handleChannelDelete(existing.channel_id, guild.id);
    }
    if (config.category_id === null) throw new Error("MANAGED_CATEGORY_MISSING");
    const name = this.defaultName(member.displayName);
    const channel = await guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      parent: config.category_id,
      userLimit: 0,
      permissionOverwrites: [
        {
          id: member.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
        }
      ],
      reason: `Managed room for ${member.id}`
    });
    const room: ManagedRoomRecord = {
      channel_id: channel.id,
      deployment_id: this.options.deploymentId,
      guild_id: guild.id,
      owner_user_id: member.id,
      category_id: config.category_id,
      settings: this.defaultSettings(name)
    };
    this.storeRoom(room);
    try {
      await member.voice.setChannel(channel, "Move to newly created managed room");
    } catch (error) {
      this.#rooms.delete(channel.id);
      await channel.delete("Compensating cleanup after failed member move").catch(() => undefined);
      throw error;
    }
  }

  private scheduleDeleteIfEmpty(channelId: string, guild: Guild, fetched?: VoiceChannel): void {
    if (this.#deletionTimers.has(channelId)) return;
    const channel = fetched ?? guild.channels.cache.get(channelId);
    if (channel?.type !== ChannelType.GuildVoice || this.hasHuman(channel)) return;
    const timer = setTimeout(() => {
      this.#deletionTimers.delete(channelId);
      void this.withGuildLock(guild.id, () => this.deleteIfStillEmpty(channelId, guild));
    }, deletionGraceMs);
    this.#deletionTimers.set(channelId, timer);
  }

  private async deleteIfStillEmpty(channelId: string, guild: Guild): Promise<void> {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (channel?.type !== ChannelType.GuildVoice) {
      this.handleChannelDelete(channelId, guild.id);
      return;
    }
    if (this.hasHuman(channel)) return;
    await channel.delete("Managed room empty for 15 seconds");
    this.handleChannelDelete(channelId, guild.id);
  }

  private hasHuman(channel: VoiceChannel): boolean {
    return channel.members.some((member) => !member.user.bot);
  }

  private async permit(
    channel: VoiceChannel,
    room: ManagedRoomRecord,
    userId?: string
  ): Promise<void> {
    if (userId === undefined) throw new Error("USER_REQUIRED");
    if (
      !room.settings.permitted_user_ids.includes(userId) &&
      room.settings.permitted_user_ids.length >= 100
    ) {
      throw new Error("PERMITTED_USER_LIMIT_REACHED");
    }
    this.assertAclMatchesSettings(channel, room, userId, { connect: true });
    await channel.permissionOverwrites.edit(userId, { Connect: true });
    room.settings.banned_user_ids = room.settings.banned_user_ids.filter((id) => id !== userId);
    if (!room.settings.permitted_user_ids.includes(userId))
      room.settings.permitted_user_ids.push(userId);
  }

  private async unpermit(
    channel: VoiceChannel,
    room: ManagedRoomRecord,
    userId?: string
  ): Promise<void> {
    if (userId === undefined) throw new Error("USER_REQUIRED");
    this.assertAclMatchesSettings(channel, room, userId, { connect: true });
    await channel.permissionOverwrites.edit(userId, {
      Connect: room.settings.banned_user_ids.includes(userId) ? false : null
    });
    room.settings.permitted_user_ids = room.settings.permitted_user_ids.filter(
      (id) => id !== userId
    );
  }

  private async kick(channel: VoiceChannel, actor: GuildMember, userId?: string): Promise<void> {
    if (userId === undefined || userId === actor.id) throw new Error("VALID_OTHER_USER_REQUIRED");
    const member = channel.members.get(userId);
    if (member === undefined) throw new Error("USER_NOT_IN_ROOM");
    await member.voice.disconnect(`Channel kick by ${actor.id}`);
  }

  private async ban(
    channel: VoiceChannel,
    room: ManagedRoomRecord,
    actor: GuildMember,
    userId?: string
  ): Promise<void> {
    if (userId === undefined || userId === actor.id) throw new Error("VALID_OTHER_USER_REQUIRED");
    if (
      !room.settings.banned_user_ids.includes(userId) &&
      room.settings.banned_user_ids.length >= 100
    ) {
      throw new Error("BANNED_USER_LIMIT_REACHED");
    }
    this.assertAclMatchesSettings(channel, room, userId, { connect: true });
    await channel.permissionOverwrites.edit(userId, { Connect: false });
    room.settings.permitted_user_ids = room.settings.permitted_user_ids.filter(
      (id) => id !== userId
    );
    if (!room.settings.banned_user_ids.includes(userId)) room.settings.banned_user_ids.push(userId);
    const member = channel.members.get(userId);
    if (member !== undefined) await member.voice.disconnect(`Channel ban by ${actor.id}`);
  }

  private async unban(
    channel: VoiceChannel,
    room: ManagedRoomRecord,
    userId?: string
  ): Promise<void> {
    if (userId === undefined) throw new Error("USER_REQUIRED");
    this.assertAclMatchesSettings(channel, room, userId, { connect: true });
    await channel.permissionOverwrites.edit(userId, {
      Connect: room.settings.permitted_user_ids.includes(userId) ? true : null
    });
    room.settings.banned_user_ids = room.settings.banned_user_ids.filter((id) => id !== userId);
  }

  private async claim(
    channel: VoiceChannel,
    room: ManagedRoomRecord,
    claimant: GuildMember
  ): Promise<void> {
    if (channel.members.has(room.owner_user_id)) throw new Error("CURRENT_OWNER_IS_PRESENT");
    const existing = [...this.#rooms.values()].find(
      (candidate) =>
        candidate.guild_id === room.guild_id &&
        candidate.channel_id !== room.channel_id &&
        candidate.owner_user_id === claimant.id
    );
    if (existing !== undefined) throw new Error("CLAIMANT_ALREADY_OWNS_A_ROOM");
    const priorOwnerId = room.owner_user_id;
    this.assertAclMatchesSettings(channel, room, priorOwnerId, { connect: true, view: true });
    this.assertAclMatchesSettings(channel, room, claimant.id, { connect: true, view: true });
    const nextName = this.defaultName(claimant.displayName);
    const claimantConnect = this.expectedConnectState(room, claimant.id);
    const claimantView = this.expectedViewState(room, claimant.id);
    try {
      await channel.permissionOverwrites.edit(priorOwnerId, {
        Connect: null,
        ViewChannel: null
      });
      await channel.permissionOverwrites.edit(claimant.id, {
        Connect: true,
        ViewChannel: true
      });
      await channel.setName(nextName, `Room claimed by ${claimant.id}`);
    } catch (error) {
      await Promise.all([
        channel.permissionOverwrites
          .edit(priorOwnerId, { Connect: true, ViewChannel: true })
          .catch(() => undefined),
        channel.permissionOverwrites
          .edit(claimant.id, {
            Connect: this.permissionEditValue(claimantConnect),
            ViewChannel: this.permissionEditValue(claimantView)
          })
          .catch(() => undefined)
      ]);
      throw error;
    }
    room.owner_user_id = claimant.id;
    room.settings.name = nextName;
    room.settings.permitted_user_ids = room.settings.permitted_user_ids.filter(
      (id) => id !== claimant.id
    );
    room.settings.banned_user_ids = room.settings.banned_user_ids.filter(
      (id) => id !== claimant.id
    );
  }

  private async reset(channel: VoiceChannel, room: ManagedRoomRecord): Promise<void> {
    const owner = await channel.guild.members.fetch(room.owner_user_id).catch(() => null);
    const name = this.defaultName(owner?.displayName ?? "Temporary");
    const affectedIds = new Set([
      ...room.settings.permitted_user_ids,
      ...room.settings.banned_user_ids,
      channel.guild.roles.everyone.id
    ]);
    for (const id of affectedIds) {
      this.assertAclMatchesSettings(channel, room, id, { connect: true });
    }
    this.assertAclMatchesSettings(channel, room, room.owner_user_id, {
      connect: true,
      view: true
    });
    await Promise.all(
      [...affectedIds].map((id) => channel.permissionOverwrites.edit(id, { Connect: null }))
    );
    await channel.permissionOverwrites.edit(room.owner_user_id, {
      Connect: true,
      ViewChannel: true
    });
    await Promise.all([
      channel.setName(name, "Reset managed-room settings"),
      channel.setUserLimit(0, "Reset managed-room settings")
    ]);
    room.settings = this.defaultSettings(name);
  }

  private assertAclMatchesSettings(
    channel: VoiceChannel,
    room: ManagedRoomRecord,
    subjectId: string,
    bits: { connect?: boolean; view?: boolean }
  ): void {
    if (
      bits.connect &&
      this.permissionState(channel, subjectId, PermissionFlagsBits.Connect) !==
        this.expectedConnectState(room, subjectId)
    ) {
      throw new Error("ACL_CHANGED_BY_STAFF");
    }
    if (
      bits.view &&
      this.permissionState(channel, subjectId, PermissionFlagsBits.ViewChannel) !==
        this.expectedViewState(room, subjectId)
    ) {
      throw new Error("ACL_CHANGED_BY_STAFF");
    }
  }

  private expectedConnectState(
    room: ManagedRoomRecord,
    subjectId: string
  ): "allow" | "deny" | "neutral" {
    if (subjectId === room.owner_user_id) return "allow";
    if (subjectId === room.guild_id) return room.settings.locked ? "deny" : "neutral";
    if (room.settings.banned_user_ids.includes(subjectId)) return "deny";
    if (room.settings.permitted_user_ids.includes(subjectId)) return "allow";
    return "neutral";
  }

  private expectedViewState(
    room: ManagedRoomRecord,
    subjectId: string
  ): "allow" | "deny" | "neutral" {
    return subjectId === room.owner_user_id ? "allow" : "neutral";
  }

  private permissionState(
    channel: VoiceChannel,
    subjectId: string,
    permission: bigint
  ): "allow" | "deny" | "neutral" | "conflict" {
    const overwrite = channel.permissionOverwrites.cache.get(subjectId);
    const allowed = overwrite?.allow.has(permission) === true;
    const denied = overwrite?.deny.has(permission) === true;
    if (allowed && denied) return "conflict";
    if (allowed) return "allow";
    if (denied) return "deny";
    return "neutral";
  }

  private permissionEditValue(state: "allow" | "deny" | "neutral"): boolean | null {
    if (state === "allow") return true;
    if (state === "deny") return false;
    return null;
  }

  private storeConfig(config: GuildConfigRecord): void {
    this.#configs.set(config.guild_id, config);
    this.options.onEvent({ type: "guild_config_event", config });
  }

  private storeRoom(room: ManagedRoomRecord): void {
    this.#rooms.set(room.channel_id, room);
    this.options.onEvent({ type: "managed_room_event", operation: "upsert", room });
  }

  private describeRoom(room: ManagedRoomRecord): string {
    return [
      `Name: ${room.settings.name}`,
      `Size: ${room.settings.user_limit === 0 ? "unlimited" : room.settings.user_limit}`,
      `Locked: ${room.settings.locked ? "yes" : "no"}`,
      `Permitted users: ${room.settings.permitted_user_ids.length}`,
      `Banned users: ${room.settings.banned_user_ids.length}`,
      `Owner: <@${room.owner_user_id}>`
    ].join("\n");
  }

  private defaultName(displayName: string): string {
    const safe = displayName
      .replace(/[\u0000-\u001F\u007F]/gu, "")
      .trim()
      .slice(0, 88);
    return `${safe || "Temporary"}'s room`.slice(0, 100);
  }

  private defaultSettings(name: string): ManagedRoomSettings {
    return {
      name,
      user_limit: 0,
      locked: false,
      permitted_user_ids: [],
      banned_user_ids: []
    };
  }

  private validateName(value: string): string {
    const name = value.replace(/[\u0000-\u001F\u007F]/gu, "").trim();
    if (name.length === 0 || name.length > 100) throw new Error("NAME_MUST_BE_1_TO_100_CHARACTERS");
    return name;
  }

  private parseUserLimit(value: string): number {
    if (value.toLowerCase() === "unlimited") return 0;
    if (!/^\d{1,2}$/u.test(value)) throw new Error("SIZE_MUST_BE_1_TO_99_OR_UNLIMITED");
    const limit = Number(value);
    if (limit < 1 || limit > 99) throw new Error("SIZE_MUST_BE_1_TO_99_OR_UNLIMITED");
    return limit;
  }

  private requireAdministrator(member: GuildMember): void {
    if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      throw new Error("MANAGE_CHANNELS_REQUIRED");
    }
  }

  private async withGuildLock<T>(guildId: string, operation: () => Promise<T> | T): Promise<T> {
    const previous = (this.#guildOperations.get(guildId) ?? Promise.resolve()).catch(
      () => undefined
    );
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.#guildOperations.set(guildId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#guildOperations.get(guildId) === tail) this.#guildOperations.delete(guildId);
    }
  }
}
