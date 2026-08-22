import { voiceApplicationCommands } from "../apps/voice-agent/src/command-data.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}

const applicationId = required("VOICE_DISCORD_APPLICATION_ID");
const guildId = required("VOICE_GUILD_ID");
const botToken = required("DISCORD_BOT_TOKEN");
const registration = await fetch(
  `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`,
  {
    method: "PUT",
    headers: {
      authorization: `Bot ${botToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(voiceApplicationCommands)
  }
);
if (!registration.ok) throw new Error(`DISCORD_VOICE_COMMAND_REGISTRATION_${registration.status}`);
const result = (await registration.json()) as unknown[];
console.log(`Registered ${result.length} voice commands in the authorized guild.`);
