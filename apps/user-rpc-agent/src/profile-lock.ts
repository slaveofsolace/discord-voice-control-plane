/* eslint-disable security/detect-non-literal-fs-filename -- the lock path is derived from a bounded deployment name beneath the protected profile root */
import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, unlink, type FileHandle } from "node:fs/promises";
import { resolve } from "node:path";

interface LockRecord {
  pid: number;
  profile: string;
  token: string;
}

function safeScope(value: string): string {
  const scope = value.replaceAll(/[^a-zA-Z0-9_-]/gu, "-").slice(0, 64);
  if (scope.length === 0) throw new Error("PROFILE_LOCK_SCOPE_INVALID");
  return scope;
}

function processAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readLockRecord(path: string): Promise<LockRecord | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as LockRecord;
  } catch {
    return null;
  }
}

export class ProfileRuntimeLock {
  private constructor(
    readonly path: string,
    private readonly handle: FileHandle,
    private readonly record: LockRecord
  ) {}

  static async acquire(
    secretRoot: string,
    deploymentId: string,
    profileName: string
  ): Promise<ProfileRuntimeLock> {
    await mkdir(secretRoot, { recursive: true, mode: 0o700 });
    const path = resolve(secretRoot, `${safeScope(deploymentId)}.active-profile.lock`);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const record: LockRecord = {
        pid: process.pid,
        profile: profileName,
        token: randomBytes(24).toString("base64url")
      };
      try {
        const handle = await open(path, "wx", 0o600);
        await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
        await handle.sync();
        return new ProfileRuntimeLock(path, handle, record);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = await readLockRecord(path);
        if (existing !== null && processAlive(existing.pid)) {
          throw new Error(`PROFILE_ALREADY_ACTIVE:${existing.profile}`, { cause: error });
        }
        await unlink(path).catch((unlinkError: unknown) => {
          if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") throw unlinkError;
        });
      }
    }
    throw new Error("PROFILE_LOCK_ACQUIRE_FAILED");
  }

  async close(): Promise<void> {
    await this.handle.close();
    const existing = await readLockRecord(this.path);
    if (existing?.token === this.record.token) {
      await unlink(this.path).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
    }
  }
}
