import { ChannelType, SlashCommandBuilder } from "discord.js";

export const voiceCommand = new SlashCommandBuilder()
  .setName("voice")
  .setDescription("Manage the temporary voice room you are using")
  .addSubcommand((command) => command.setName("info").setDescription("View your channel settings"))
  .addSubcommand((command) =>
    command
      .setName("name")
      .setDescription("Rename your channel")
      .addStringOption((option) =>
        option
          .setName("name")
          .setDescription("New channel name")
          .setRequired(true)
          .setMaxLength(100)
      )
  )
  .addSubcommand((command) =>
    command
      .setName("size")
      .setDescription("Set your channel size")
      .addStringOption((option) =>
        option.setName("amount").setDescription("1 through 99, or unlimited").setRequired(true)
      )
  )
  .addSubcommand((command) => command.setName("lock").setDescription("Make your channel private"))
  .addSubcommand((command) => command.setName("unlock").setDescription("Make your channel public"))
  .addSubcommand((command) =>
    command
      .setName("permit")
      .setDescription("Allow a user to join")
      .addUserOption((option) => option.setName("user").setDescription("User").setRequired(true))
  )
  .addSubcommand((command) =>
    command
      .setName("unpermit")
      .setDescription("Remove a user from the allowed list")
      .addUserOption((option) => option.setName("user").setDescription("User").setRequired(true))
  )
  .addSubcommand((command) =>
    command
      .setName("kick")
      .setDescription("Disconnect a user from your channel")
      .addUserOption((option) => option.setName("user").setDescription("User").setRequired(true))
  )
  .addSubcommand((command) =>
    command
      .setName("ban")
      .setDescription("Deny a user access to your channel")
      .addUserOption((option) => option.setName("user").setDescription("User").setRequired(true))
  )
  .addSubcommand((command) =>
    command
      .setName("unban")
      .setDescription("Remove a channel access ban")
      .addUserOption((option) => option.setName("user").setDescription("User").setRequired(true))
  )
  .addSubcommand((command) => command.setName("reset").setDescription("Reset your voice settings"))
  .addSubcommand((command) => command.setName("claim").setDescription("Claim an ownerless room"));

export const voiceAdminCommand = new SlashCommandBuilder()
  .setName("voice-admin")
  .setDescription("Configure the authorized voice bot")
  .addSubcommand((command) =>
    command.setName("setup").setDescription("Create or repair the managed-room category and lobby")
  )
  .addSubcommand((command) =>
    command.setName("status").setDescription("Show managed-room configuration")
  )
  .addSubcommand((command) =>
    command.setName("enable").setDescription("Enable managed-room creation")
  )
  .addSubcommand((command) =>
    command.setName("disable").setDescription("Disable managed-room creation")
  )
  .addSubcommand((command) =>
    command
      .setName("authorize-target")
      .setDescription("Authorize the exact voice channel used by the control plane")
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Approved target voice channel")
          .addChannelTypes(ChannelType.GuildVoice)
          .setRequired(true)
      )
  );

export const voiceApplicationCommands = [voiceCommand.toJSON(), voiceAdminCommand.toJSON()];
