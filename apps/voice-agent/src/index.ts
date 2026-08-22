import { createServer } from "node:http";

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  type GuildMember,
  type VoiceChannel
} from "discord.js";

import { voiceEnvironmentSchema } from "@discord-vc-control/config";
import { AgentClient } from "@discord-vc-control/agent-client";
import {
  voiceSessionStateSchema,
  type AgentBootstrap,
  type AgentMessage,
  type CommandAck,
  type CommandEnvelope
} from "@discord-vc-control/contracts";
import { redactSecrets } from "@discord-vc-control/security";

import { ManagedRoomService } from "./managed-rooms.js";
import { parsePrefixCommand, voiceSubcommands, type VoiceSubcommand } from "./prefix.js";
import { asVoiceAdminSubcommand, requiresManageChannels } from "./voice-admin-authorization.js";
import { VoiceController } from "./voice-controller.js";
import { authorizeControlRelayMessage, type ControlRelayConfig } from "./control-relay.js";
import { RelayIngressClient } from "./relay-ingress-client.js";

const environment = voiceEnvironmentSchema.parse(process.env);
const port = Number(process.env.PORT ?? "8080");
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("INVALID_PORT");

const secrets = [
  environment.DISCORD_BOT_TOKEN,
  environment.AGENT_AUTH_SECRET,
  environment.AGENT_PREVIOUS_AUTH_SECRET ?? ""
];

function log(
  level: "error" | "info" | "warn",
  event: string,
  details: Record<string, unknown> = {}
): void {
  const safeDetails = Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      typeof value === "string" ? redactSecrets(value, secrets) : value
    ])
  );
  const line = JSON.stringify({
    level,
    event,
    service: "voice-agent",
    at: new Date().toISOString(),
    ...safeDetails
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

const intents = [GatewayIntentBits.Guilds];
if (!environment.CONTROL_RELAY_ONLY) intents.push(GatewayIntentBits.GuildVoiceStates);
if (environment.PREFIX_COMMANDS_ENABLED || environment.CONTROL_RELAY_ENABLED) {
  intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
}
const client = new Client({
  intents,
  allowedMentions: { parse: [], repliedUser: false }
});

let lastBootstrap: AgentBootstrap | null = null;
const commandReceipts = new Map<string, CommandAck>();
const relayConfig: ControlRelayConfig | null = environment.CONTROL_RELAY_ENABLED
  ? {
      applicationId: environment.CONTROL_RELAY_APPLICATION_ID,
      channelId: environment.CONTROL_RELAY_CHANNEL_ID,
      deploymentId: environment.DEPLOYMENT_ID,
      elevatedRoleIds: environment.CONTROL_ELEVATED_ROLE_IDS,
      elevatedUserIds: environment.CONTROL_ELEVATED_USER_IDS,
      guildId: environment.CONTROL_GUILD_ID,
      operatorRoleIds: environment.CONTROL_OPERATOR_ROLE_IDS,
      operatorUserIds: environment.CONTROL_OPERATOR_USER_IDS,
      tenantId: environment.TENANT_ID
    }
  : null;
const relayIngress = environment.CONTROL_RELAY_ENABLED
  ? new RelayIngressClient({
      endpoint: environment.RELAY_INGRESS_ENDPOINT,
      secret: environment.RELAY_INGRESS_HMAC_SECRET
    })
  : null;
let relayApplicationVerified = relayConfig === null;

const controller = new VoiceController({
  client,
  deploymentId: environment.DEPLOYMENT_ID,
  onStatus: (status) => agentClient?.send(status)
});

const managedRooms = new ManagedRoomService({
  deploymentId: environment.DEPLOYMENT_ID,
  managedGuildIds: environment.MANAGED_GUILD_IDS,
  managedRoomsEnabled: environment.MANAGED_ROOMS_ENABLED,
  prefixCommandsEnabled: environment.PREFIX_COMMANDS_ENABLED,
  targetApproverUserIds: environment.TARGET_APPROVER_USER_IDS,
  onEvent: (event: AgentMessage) => {
    if (event.type === "authorized_target_event") controller.setTarget(event.target);
    agentClient?.send(event);
  }
});

async function applyBootstrap(bootstrap: AgentBootstrap): Promise<void> {
  lastBootstrap = bootstrap;
  managedRooms.applyBootstrap(bootstrap);
  controller.setTarget(bootstrap.authorized_target);
  if (client.isReady()) {
    await reconcileManagedRooms(bootstrap);
    await controller
      .applyDesiredState(bootstrap.desired_connected, bootstrap.paused)
      .catch((error: unknown) =>
        log("warn", "bootstrap_voice_state_rejected", {
          code: error instanceof Error ? error.message : "UNKNOWN"
        })
      );
  }
}

async function reconcileManagedRooms(bootstrap: AgentBootstrap): Promise<void> {
  const guildIds = new Set(bootstrap.managed_rooms.map((room) => room.guild_id));
  for (const guildId of guildIds) {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (guild === null) continue;
    await managedRooms.reconcileGuild(guild);
  }
}

async function handleControlCommand(command: CommandEnvelope, duplicate: boolean): Promise<void> {
  if (duplicate) {
    const receipt = commandReceipts.get(command.command_id);
    if (receipt !== undefined) {
      agentClient?.send({ ...receipt, duplicate: true, occurred_at: Date.now() });
    }
    return;
  }
  const receipt = await controller.execute(command);
  commandReceipts.set(command.command_id, receipt);
  agentClient?.send(receipt);
}

const agentClient: AgentClient | null = environment.CONTROL_RELAY_ONLY
  ? null
  : new AgentClient({
      deploymentId: environment.DEPLOYMENT_ID,
      tenantId: environment.TENANT_ID,
      endpoint: environment.AGENT_ENDPOINT,
      keyId: environment.AGENT_KEY_ID,
      secret: environment.AGENT_AUTH_SECRET,
      ...(environment.AGENT_PREVIOUS_KEY_ID === undefined
        ? {}
        : { previousKeyId: environment.AGENT_PREVIOUS_KEY_ID }),
      ...(environment.AGENT_PREVIOUS_AUTH_SECRET === undefined
        ? {}
        : { previousSecret: environment.AGENT_PREVIOUS_AUTH_SECRET }),
      onBlocked: (code) => controller.handleControlPlaneFailure(code),
      onBootstrap: applyBootstrap,
      onCommand: handleControlCommand
    });
if (!environment.CONTROL_RELAY_ONLY) controller.start();

function asVoiceSubcommand(value: string): VoiceSubcommand {
  if (!(voiceSubcommands as readonly string[]).includes(value))
    throw new Error("UNKNOWN_VOICE_COMMAND");
  return value as VoiceSubcommand;
}

async function guildMemberFor(userId: string, guildId: string): Promise<GuildMember> {
  const guild = await client.guilds.fetch(guildId);
  return guild.members.fetch(userId);
}

client.once(Events.ClientReady, (readyClient) => {
  void (async () => {
    if (relayConfig !== null && readyClient.application.id !== relayConfig.applicationId) {
      log("error", "control_relay_application_mismatch");
      await readyClient.destroy();
      return;
    }
    relayApplicationVerified = true;
    log("info", "gateway_ready", { bot_user_id: readyClient.user.id });
    if (environment.CONTROL_RELAY_ONLY) return;
    if (lastBootstrap !== null) {
      await reconcileManagedRooms(lastBootstrap);
      await controller
        .applyDesiredState(lastBootstrap.desired_connected, lastBootstrap.paused)
        .catch((error: unknown) =>
          log("warn", "bootstrap_voice_state_rejected", {
            code: error instanceof Error ? error.message : "UNKNOWN"
          })
        );
    }
  })().catch((error: unknown) =>
    log("warn", "bootstrap_state_not_applied", {
      code: error instanceof Error ? error.message : "UNKNOWN"
    })
  );
});

client.on(Events.InteractionCreate, (interaction) => {
  void (async () => {
    if (
      interaction.isButton() &&
      interaction.inGuild() &&
      relayConfig !== null &&
      relayIngress !== null
    ) {
      if (!relayApplicationVerified) return;
      const match = /^relay:(status|cancel):([a-f\d-]{36})$/iu.exec(interaction.customId);
      if (match?.[1] === undefined || match[2] === undefined) return;
      const member = await guildMemberFor(interaction.user.id, interaction.guildId);
      const operation = match[1].toLowerCase() as "status" | "cancel";
      const result = await relayIngress.send({
        version: 1,
        operation,
        deployment_id: relayConfig.deploymentId,
        tenant_id: relayConfig.tenantId,
        application_id: relayConfig.applicationId,
        source_message_id: interaction.id,
        actor_user_id: interaction.user.id,
        actor_role_ids: [...member.roles.cache.keys()],
        control_guild_id: interaction.guildId,
        control_channel_id: interaction.channelId,
        request_id: match[2]
      });
      await interaction.reply({
        content: `Relay request ${result.request_id ?? match[2]}: ${result.status ?? "unavailable"} (${result.result_code}).`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] }
      });
      return;
    }
    if (!interaction.isChatInputCommand() || !interaction.inGuild()) return;
    if (environment.CONTROL_RELAY_ONLY) return;
    if (interaction.commandName !== "voice" && interaction.commandName !== "voice-admin") return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const member = await guildMemberFor(interaction.user.id, interaction.guildId);
      if (interaction.commandName === "voice") {
        const subcommand = asVoiceSubcommand(interaction.options.getSubcommand(true));
        const argument =
          subcommand === "name"
            ? interaction.options.getString("name", true)
            : subcommand === "size"
              ? interaction.options.getString("amount", true)
              : undefined;
        const userId = ["permit", "unpermit", "kick", "ban", "unban"].includes(subcommand)
          ? interaction.options.getUser("user", true).id
          : undefined;
        const content = await managedRooms.execute({
          member,
          subcommand,
          ...(argument === undefined ? {} : { argument }),
          ...(userId === undefined ? {} : { userId })
        });
        await interaction.editReply({ content, allowedMentions: { parse: [] } });
        return;
      }
      const subcommand = asVoiceAdminSubcommand(interaction.options.getSubcommand(true));
      if (
        requiresManageChannels(subcommand) &&
        !member.permissions.has(PermissionFlagsBits.ManageChannels)
      ) {
        throw new Error("MANAGE_CHANNELS_REQUIRED");
      }
      let content: string;
      if (subcommand === "setup") {
        const config = await managedRooms.setup(member.guild, member);
        content = `Managed-room channels are configured. Enabled: ${config.managed_rooms_enabled ? "yes" : "no"}.`;
      } else if (subcommand === "status") {
        content = managedRooms.status(member.guild.id);
      } else if (subcommand === "enable" || subcommand === "disable") {
        if (subcommand === "enable" && !environment.MANAGED_ROOMS_ENABLED) {
          throw new Error("MANAGED_ROOMS_DISABLED_BY_DEPLOYMENT");
        }
        const config = await managedRooms.setEnabled(member.guild, member, subcommand === "enable");
        content = `Managed rooms ${config.managed_rooms_enabled ? "enabled" : "disabled"}.`;
      } else if (subcommand === "authorize-target") {
        const channel = interaction.options.getChannel("channel", true);
        if (channel.type !== ChannelType.GuildVoice)
          throw new Error("GUILD_VOICE_CHANNEL_REQUIRED");
        managedRooms.authorizeTarget(member.guild, member, channel as VoiceChannel);
        content = `Authorized exact target ${channel.id}.`;
      } else {
        throw new Error("UNKNOWN_VOICE_ADMIN_COMMAND");
      }
      await interaction.editReply({ content, allowedMentions: { parse: [] } });
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 120) : "COMMAND_FAILED";
      await interaction.editReply({
        content: `Command rejected: ${code}.`,
        allowedMentions: { parse: [] }
      });
    }
  })().catch((error: unknown) =>
    log("error", "interaction_handler_failed", {
      code: error instanceof Error ? error.message : "UNKNOWN"
    })
  );
});

if (environment.PREFIX_COMMANDS_ENABLED || environment.CONTROL_RELAY_ENABLED) {
  client.on(Events.MessageCreate, (message) => {
    void (async () => {
      if (
        relayConfig !== null &&
        relayIngress !== null &&
        message.guildId === relayConfig.guildId &&
        message.channelId === relayConfig.channelId
      ) {
        if (message.author.bot) return;
        if (!relayApplicationVerified) {
          await message.reply({
            content: "Relay rejected: CONTROL_RELAY_APPLICATION_MISMATCH.",
            allowedMentions: { parse: [], repliedUser: false }
          });
          return;
        }
        try {
          const member =
            message.member ?? (await message.guild?.members.fetch(message.author.id)) ?? null;
          if (member === null) throw new Error("RELAY_MEMBER_UNAVAILABLE");
          const authorized = authorizeControlRelayMessage(
            {
              actorRoleIds: [...member.roles.cache.keys()],
              actorUserId: message.author.id,
              applicationId: relayConfig.applicationId,
              attachmentCount: message.attachments.size,
              bot: message.author.bot,
              channelId: message.channelId,
              content: message.content,
              edited: message.editedTimestamp !== null,
              embedCount: message.embeds.length,
              guildId: message.guildId,
              messageId: message.id,
              thread: message.channel.isThread(),
              webhook: message.webhookId !== null
            },
            relayConfig
          );
          const result = await relayIngress.send(authorized.request);
          if (!result.accepted || result.request_id === null) throw new Error(result.result_code);
          const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`relay:status:${result.request_id}`)
              .setLabel("Status")
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId(`relay:cancel:${result.request_id}`)
              .setLabel("Cancel")
              .setStyle(ButtonStyle.Danger)
          );
          await message.reply({
            content: `Relay request ${result.request_id}: ${result.status ?? "RECEIVED"} (${result.result_code}).${authorized.parsed.risk === "ELEVATED" ? " ELEVATED RISK — local owner review required." : ""}`,
            components: [controls],
            allowedMentions: { parse: [], repliedUser: false }
          });
        } catch (error) {
          const code = error instanceof Error ? error.message.slice(0, 64) : "RELAY_REJECTED";
          await message.reply({
            content: `Relay rejected: ${code}.`,
            allowedMentions: { parse: [], repliedUser: false }
          });
        }
        return;
      }
      if (!environment.PREFIX_COMMANDS_ENABLED) return;
      if (
        message.author.bot ||
        message.guild === null ||
        !managedRooms.prefixEnabledForGuild(message.guild.id)
      )
        return;
      try {
        const parsed = parsePrefixCommand(message.content);
        if (parsed === null) return;
        const member = await message.guild.members.fetch(message.author.id);
        const content = await managedRooms.executePrefix(member, parsed);
        await message.reply({ content, allowedMentions: { parse: [], repliedUser: false } });
      } catch (error) {
        const code = error instanceof Error ? error.message.slice(0, 120) : "COMMAND_FAILED";
        await message.reply({
          content: `Command rejected: ${code}.`,
          allowedMentions: { parse: [], repliedUser: false }
        });
      }
    })().catch((error: unknown) =>
      log("error", "prefix_handler_failed", {
        code: error instanceof Error ? error.message : "UNKNOWN"
      })
    );
  });
}

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  if (environment.CONTROL_RELAY_ONLY) return;
  if (oldState.id === client.user?.id || newState.id === client.user?.id) {
    controller.handleOwnVoiceState(oldState, newState);
  }
  void managedRooms.handleVoiceState(oldState, newState).catch((error: unknown) =>
    log("warn", "managed_room_voice_state_failed", {
      code: error instanceof Error ? error.message : "UNKNOWN"
    })
  );
});

client.on(Events.ChannelDelete, (channel) => {
  if (environment.CONTROL_RELAY_ONLY) return;
  if (!("guildId" in channel)) return;
  managedRooms.handleChannelDelete(channel.id, channel.guildId);
  controller.handleChannelDelete(channel.id);
});

client.on(Events.Error, (error) => log("error", "discord_client_error", { code: error.message }));
client.on(Events.Warn, (message) => log("warn", "discord_client_warning", { code: message }));

const healthServer = createServer((request, response) => {
  if (request.method !== "GET" || request.url !== "/healthz") {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(
    JSON.stringify({
      ok: true,
      service: "voice-agent",
      observed_state: controller.status.observed_state
    })
  );
});
healthServer.listen(port, "0.0.0.0", () => log("info", "health_listener_ready", { port }));

const heartbeatTimer = setInterval(() => {
  agentClient?.send({
    type: "heartbeat",
    deployment_id: environment.DEPLOYMENT_ID,
    sent_at: Date.now(),
    gateway_sequence: null
  });
  agentClient?.send(controller.status);
  const cutoff = Date.now() - 24 * 60 * 60_000;
  for (const [commandId, receipt] of commandReceipts) {
    if (receipt.occurred_at < cutoff) commandReceipts.delete(commandId);
  }
}, 15_000);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log("info", "shutdown_started", { signal });
  clearInterval(heartbeatTimer);
  if (!environment.CONTROL_RELAY_ONLY) controller.shutdown();
  agentClient?.send(controller.status);
  agentClient?.close();
  await client.destroy();
  await new Promise<void>((resolve) => healthServer.close(() => resolve()));
  log("info", "shutdown_complete");
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

await Promise.all([
  client.login(environment.DISCORD_BOT_TOKEN),
  agentClient?.start() ?? Promise.resolve()
]);
if (!voiceSessionStateSchema.safeParse(controller.status.observed_state).success) {
  throw new Error("INVALID_INITIAL_STATE");
}
