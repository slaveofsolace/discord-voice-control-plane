import { createServer } from "node:http";

import {
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
import {
  voiceSessionStateSchema,
  type AgentBootstrap,
  type AgentMessage,
  type CommandAck,
  type CommandEnvelope
} from "@discord-vc-control/contracts";
import { redactSecrets } from "@discord-vc-control/security";

import { AgentClient } from "./agent-client.js";
import { ManagedRoomService } from "./managed-rooms.js";
import { parsePrefixCommand, voiceSubcommands, type VoiceSubcommand } from "./prefix.js";
import { VoiceController } from "./voice-controller.js";

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

const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates];
if (environment.PREFIX_COMMANDS_ENABLED) {
  intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
}
const client = new Client({
  intents,
  allowedMentions: { parse: [], repliedUser: false }
});

let lastBootstrap: AgentBootstrap | null = null;
const commandReceipts = new Map<string, CommandAck>();

const controller = new VoiceController({
  client,
  deploymentId: environment.DEPLOYMENT_ID,
  onStatus: (status) => agentClient.send(status)
});

const managedRooms = new ManagedRoomService({
  deploymentId: environment.DEPLOYMENT_ID,
  prefixCommandsEnabled: environment.PREFIX_COMMANDS_ENABLED,
  targetApproverUserIds: environment.TARGET_APPROVER_USER_IDS,
  onEvent: (event: AgentMessage) => {
    if (event.type === "authorized_target_event") controller.setTarget(event.target);
    agentClient.send(event);
  }
});

async function applyBootstrap(bootstrap: AgentBootstrap): Promise<void> {
  lastBootstrap = bootstrap;
  managedRooms.applyBootstrap(bootstrap);
  controller.setTarget(bootstrap.authorized_target);
  if (client.isReady())
    await controller.applyDesiredState(bootstrap.desired_connected, bootstrap.paused);
}

async function handleControlCommand(command: CommandEnvelope, duplicate: boolean): Promise<void> {
  if (duplicate) {
    const receipt = commandReceipts.get(command.command_id);
    if (receipt !== undefined) {
      agentClient.send({ ...receipt, duplicate: true, occurred_at: Date.now() });
      return;
    }
  }
  const receipt = await controller.execute(command);
  commandReceipts.set(command.command_id, receipt);
  agentClient.send(receipt);
}

const agentClient = new AgentClient({
  deploymentId: environment.DEPLOYMENT_ID,
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
    log("info", "gateway_ready", { bot_user_id: readyClient.user.id });
    if (lastBootstrap !== null) {
      await controller.applyDesiredState(lastBootstrap.desired_connected, lastBootstrap.paused);
    }
  })().catch((error: unknown) =>
    log("warn", "bootstrap_state_not_applied", {
      code: error instanceof Error ? error.message : "UNKNOWN"
    })
  );
});

client.on(Events.InteractionCreate, (interaction) => {
  void (async () => {
    if (!interaction.isChatInputCommand() || !interaction.inGuild()) return;
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
      if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        throw new Error("MANAGE_CHANNELS_REQUIRED");
      }
      const subcommand = interaction.options.getSubcommand(true);
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
        const config = managedRooms.setEnabled(member.guild, member, subcommand === "enable");
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

if (environment.PREFIX_COMMANDS_ENABLED) {
  client.on(Events.MessageCreate, (message) => {
    void (async () => {
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
  response.end(JSON.stringify({ ok: true, service: "voice-agent", status: controller.status }));
});
healthServer.listen(port, "0.0.0.0", () => log("info", "health_listener_ready", { port }));

const heartbeatTimer = setInterval(() => {
  agentClient.send({
    type: "heartbeat",
    deployment_id: environment.DEPLOYMENT_ID,
    sent_at: Date.now(),
    gateway_sequence: null
  });
  agentClient.send(controller.status);
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
  controller.shutdown();
  agentClient.send(controller.status);
  agentClient.close();
  await client.destroy();
  await new Promise<void>((resolve) => healthServer.close(() => resolve()));
  log("info", "shutdown_complete");
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

await Promise.all([client.login(environment.DISCORD_BOT_TOKEN), agentClient.start()]);
if (!voiceSessionStateSchema.safeParse(controller.status.observed_state).success) {
  throw new Error("INVALID_INITIAL_STATE");
}
