import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const config = readFileSync("apps/control-worker/wrangler.jsonc", "utf8");

describe("control Worker configuration", () => {
  it("schedules physical audit-retention cleanup", () => {
    expect(config).toMatch(/"crons"\s*:\s*\["17 3 \* \* \*"\]/u);
  });

  it("keeps D1 provisioning account-neutral", () => {
    expect(config).not.toContain("database_id");
  });
});
