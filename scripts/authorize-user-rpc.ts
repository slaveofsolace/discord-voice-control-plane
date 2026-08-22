import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { snowflakeSchema } from "@discord-vc-control/contracts";
import { z } from "zod";

import { DiscordIpcClient } from "../apps/user-rpc-agent/src/discord-ipc.js";
import { DiscordRpcSession } from "../apps/user-rpc-agent/src/discord-rpc-session.js";
import { exchangeRpcAuthorizationCode } from "../apps/user-rpc-agent/src/oauth.js";
import {
  ensureUserOnlySecretDirectory,
  userRpcProfilePath,
  writeUserRpcProfile
} from "./user-rpc-profile.js";

const setupEnvironmentSchema = z.object({
  USER_RPC_DISCORD_APPLICATION_ID: snowflakeSchema,
  USER_RPC_DISCORD_CLIENT_SECRET: z.string().min(8).optional(),
  CONTROL_DISCORD_CLIENT_SECRET: z.string().min(8).optional(),
  USER_RPC_DISCORD_REDIRECT_URI: z.url(),
  USER_RPC_ALLOWED_GUILD_ID: snowflakeSchema,
  USER_RPC_PROFILE: z.string().default("main")
});

const environment = setupEnvironmentSchema.parse(process.env);
const clientSecret =
  environment.USER_RPC_DISCORD_CLIENT_SECRET ?? environment.CONTROL_DISCORD_CLIENT_SECRET;
if (clientSecret === undefined) throw new Error("USER_RPC_DISCORD_CLIENT_SECRET_REQUIRED");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profilePath = userRpcProfilePath(repoRoot, environment.USER_RPC_PROFILE);
await ensureUserOnlySecretDirectory(dirname(profilePath));

const ipc = new DiscordIpcClient(environment.USER_RPC_DISCORD_APPLICATION_ID);
const rpc = new DiscordRpcSession(ipc, environment.USER_RPC_DISCORD_APPLICATION_ID);

try {
  await rpc.connect();
  console.log(
    "Discord will ask you to authorize local RPC access. Review and approve it manually."
  );
  const code = await rpc.authorize(["rpc", "identify"]);
  const tokens = await exchangeRpcAuthorizationCode(
    {
      clientId: environment.USER_RPC_DISCORD_APPLICATION_ID,
      clientSecret,
      redirectUri: environment.USER_RPC_DISCORD_REDIRECT_URI
    },
    code
  );
  const authenticated = await rpc.authenticate(tokens.accessToken);
  await writeUserRpcProfile(
    profilePath,
    {
      applicationId: environment.USER_RPC_DISCORD_APPLICATION_ID,
      allowedGuildId: environment.USER_RPC_ALLOWED_GUILD_ID,
      expectedUserId: authenticated.userId,
      clientSecret,
      redirectUri: environment.USER_RPC_DISCORD_REDIRECT_URI,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresAt: tokens.expiresAt,
      scope: tokens.scope,
      tokenType: tokens.tokenType
    },
    { replace: false }
  );
  console.log(`Stored the authorized local Discord profile at ${profilePath}.`);
  console.log("No Discord user token was requested or stored.");
} finally {
  rpc.close();
}
