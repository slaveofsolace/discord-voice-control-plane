import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProfileRuntimeLock } from "./profile-lock.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("active RPC profile lock", () => {
  it("serializes one active profile per deployment and releases cleanly", async () => {
    const root = await mkdtemp(join(tmpdir(), "discord-profile-lock-"));
    roots.push(root);
    const main = await ProfileRuntimeLock.acquire(root, "deployment", "main");
    await expect(ProfileRuntimeLock.acquire(root, "deployment", "main")).rejects.toThrow(
      "PROFILE_ALREADY_ACTIVE:main"
    );
    await expect(ProfileRuntimeLock.acquire(root, "deployment", "presence")).rejects.toThrow(
      "PROFILE_ALREADY_ACTIVE:main"
    );
    await main.close();
    const presence = await ProfileRuntimeLock.acquire(root, "deployment", "presence");
    await presence.close();
  });
});
