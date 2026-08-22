import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const config = readFileSync("apps/control-worker/wrangler.jsonc", "utf8");
const voiceHostConfig = readFileSync("apps/voice-host-worker/wrangler.jsonc", "utf8");

describe("control Worker configuration", () => {
  it("schedules physical audit-retention cleanup", () => {
    expect(config).toMatch(/"crons"\s*:\s*\["17 3 \* \* \*"\]/u);
  });

  it("keeps D1 provisioning account-neutral", () => {
    expect(config).not.toContain("database_id");
  });

  it("declares the control-plane secrets required at deployment", () => {
    expect(config).toMatch(/"required"\s*:\s*\["AGENT_AUTH_SECRET",\s*"INTERNAL_STATUS_SECRET"\]/u);
  });

  it("declares the voice-host secrets required at deployment", () => {
    expect(voiceHostConfig).toMatch(
      /"required"\s*:\s*\["DISCORD_BOT_TOKEN",\s*"AGENT_AUTH_SECRET"\]/u
    );
  });
});
