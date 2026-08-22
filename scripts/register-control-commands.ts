import { controlApplicationCommand } from "../apps/control-worker/src/command-data.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}

const applicationId = required("CONTROL_DISCORD_APPLICATION_ID");
const guildId = required("CONTROL_GUILD_ID");
const clientSecret = required("CONTROL_DISCORD_CLIENT_SECRET");

const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
  method: "POST",
  headers: {
    authorization: `Basic ${Buffer.from(`${applicationId}:${clientSecret}`).toString("base64")}`,
    "content-type": "application/x-www-form-urlencoded"
  },
  body: new URLSearchParams({
    grant_type: "client_credentials",
    scope: "applications.commands.update"
  })
});
if (!tokenResponse.ok) throw new Error(`DISCORD_CLIENT_CREDENTIALS_${tokenResponse.status}`);
const tokenPayload = (await tokenResponse.json()) as { access_token?: unknown };
if (typeof tokenPayload.access_token !== "string") throw new Error("DISCORD_ACCESS_TOKEN_MISSING");

const registration = await fetch(
  `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`,
  {
    method: "PUT",
    headers: {
      authorization: `Bearer ${tokenPayload.access_token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify([controlApplicationCommand])
  }
);
if (!registration.ok)
  throw new Error(`DISCORD_CONTROL_COMMAND_REGISTRATION_${registration.status}`);
const result = (await registration.json()) as unknown[];
console.log(`Registered ${result.length} control command without a bot token.`);
