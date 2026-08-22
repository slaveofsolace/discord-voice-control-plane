import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { snowflakeSchema } from "@discord-vc-control/contracts";
import { z } from "zod";

const profileNameSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/u);
const profileSchema = z.object({
  applicationId: snowflakeSchema,
  allowedGuildId: snowflakeSchema,
  expectedUserId: snowflakeSchema,
  clientSecret: z.string().min(8),
  redirectUri: z.url(),
  accessToken: z.string().min(16),
  refreshToken: z.string().min(16),
  accessTokenExpiresAt: z.number().int().positive(),
  scope: z.string(),
  tokenType: z.string()
});

export type UserRpcProfile = z.infer<typeof profileSchema>;

export function userRpcProfilePath(repoRoot: string, profileName: string): string {
  const safeName = profileNameSchema.parse(profileName);
  return resolve(repoRoot, ".runtime", "secrets", "user-rpc", `${safeName}.json`);
}

export async function ensureUserOnlySecretDirectory(path: string): Promise<void> {
  // Callers pass a validated profile directory beneath the ignored runtime root.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (process.platform === "win32") {
    const username = process.env.USERNAME;
    if (username === undefined || username.length === 0) {
      throw new Error("WINDOWS_USERNAME_UNAVAILABLE");
    }
    const domain = process.env.USERDOMAIN;
    const account =
      domain === undefined || domain.length === 0 ? username : `${domain}\\${username}`;
    const acl = spawnSync(
      "icacls.exe",
      [path, "/inheritance:r", "/grant:r", `${account}:(OI)(CI)(F)`],
      { stdio: "ignore", windowsHide: true }
    );
    if (acl.status !== 0) throw new Error("LOCAL_SECRET_ACL_FAILED");
  } else {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await chmod(path, 0o700);
  }
}

export async function readUserRpcProfile(path: string): Promise<UserRpcProfile> {
  // The caller resolves a validated profile name beneath the ignored runtime directory.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return profileSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

export async function writeUserRpcProfile(
  path: string,
  profile: UserRpcProfile,
  options: { replace: boolean }
): Promise<void> {
  const validated = profileSchema.parse(profile);
  // The caller resolves a validated profile name beneath the ignored runtime directory.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await writeFile(path, `${JSON.stringify(validated, null, 2)}\n`, {
    encoding: "utf8",
    flag: options.replace ? "w" : "wx",
    mode: 0o600
  });
}
