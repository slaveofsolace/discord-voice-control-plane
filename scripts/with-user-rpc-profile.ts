import { dirname, resolve } from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { refreshRpcAccessToken } from "../apps/user-rpc-agent/src/oauth.js";
import { readUserRpcProfile, userRpcProfilePath, writeUserRpcProfile } from "./user-rpc-profile.js";

const requested = process.argv.slice(2);
if (requested[0] === "--") requested.shift();
const executable = requested.shift();
if (executable === undefined) throw new Error("LOCAL_PROFILE_COMMAND_REQUIRED");

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profileName = process.env.USER_RPC_PROFILE ?? "main";
const profilePath = userRpcProfilePath(repoRoot, profileName);
let profile = await readUserRpcProfile(profilePath);

if (profile.accessTokenExpiresAt <= Date.now() + 5 * 60_000) {
  const refreshed = await refreshRpcAccessToken(
    {
      clientId: profile.applicationId,
      clientSecret: profile.clientSecret,
      redirectUri: profile.redirectUri
    },
    profile.refreshToken
  );
  profile = {
    ...profile,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    accessTokenExpiresAt: refreshed.expiresAt,
    scope: refreshed.scope,
    tokenType: refreshed.tokenType
  };
  await writeUserRpcProfile(profilePath, profile, { replace: true });
}

const child = spawn(executable, requested, {
  env: {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) =>
          name !== "CONTROL_DISCORD_CLIENT_SECRET" && name !== "USER_RPC_DISCORD_CLIENT_SECRET"
      )
    ),
    USER_RPC_DISCORD_APPLICATION_ID: profile.applicationId,
    USER_RPC_DISCORD_ACCESS_TOKEN: profile.accessToken,
    USER_RPC_ALLOWED_GUILD_ID: profile.allowedGuildId,
    USER_RPC_EXPECTED_USER_ID: profile.expectedUserId
  },
  shell: false,
  stdio: "inherit",
  windowsHide: true
});

const exitCode = await new Promise<number>((resolveExit, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (signal !== null) reject(new Error(`LOCAL_PROFILE_COMMAND_SIGNAL_${signal}`));
    else resolveExit(code ?? 1);
  });
});

process.exitCode = exitCode;
