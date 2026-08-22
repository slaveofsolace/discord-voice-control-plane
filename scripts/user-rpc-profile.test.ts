import { describe, expect, it } from "vitest";
import { resolve } from "node:path";

import { userRpcProfilePath } from "./user-rpc-profile.js";

describe("local user RPC profile paths", () => {
  it("keeps validated profile names beneath the ignored runtime directory", () => {
    const repoRoot = resolve("fixture-repo");
    expect(userRpcProfilePath(repoRoot, "main")).toBe(
      resolve(repoRoot, ".runtime", "secrets", "user-rpc", "main.json")
    );
    expect(() => userRpcProfilePath(repoRoot, "../escape")).toThrow();
    expect(() => userRpcProfilePath(repoRoot, "Main Account")).toThrow();
  });
});
