import { describe, expect, it } from "vitest";

import { buildVoiceRoomsInstallUrl, VOICE_INSTALL_PERMISSIONS } from "./discord-install-url.js";

const applicationId = "100000000000000001";
const guildId = "100000000000000002";

describe("Voice Rooms install URL", () => {
  it("builds a guild-locked presence-only install", () => {
    const url = buildVoiceRoomsInstallUrl({
      applicationId,
      guildId,
      profile: "presence-only"
    });

    expect(url.origin).toBe("https://discord.com");
    expect(url.pathname).toBe("/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe(applicationId);
    expect(url.searchParams.get("guild_id")).toBe(guildId);
    expect(url.searchParams.get("disable_guild_select")).toBe("true");
    expect(url.searchParams.get("integration_type")).toBe("0");
    expect(url.searchParams.get("permissions")).toBe("1117184");
    expect(new Set(url.searchParams.get("scope")?.split(" "))).toEqual(
      new Set(["applications.commands", "bot"])
    );
  });

  it("uses only the documented managed-room bitset", () => {
    const url = buildVoiceRoomsInstallUrl({
      applicationId,
      guildId,
      profile: "managed-rooms"
    });

    expect(url.searchParams.get("permissions")).toBe("286329872");
    expect(VOICE_INSTALL_PERMISSIONS).toEqual({
      "presence-only": "1117184",
      "managed-rooms": "286329872"
    });
  });

  it.each(["0", "123", "not-a-snowflake", "100000000000000001000"])(
    "rejects invalid application snowflake %s",
    (invalid) => {
      expect(() =>
        buildVoiceRoomsInstallUrl({
          applicationId: invalid,
          guildId,
          profile: "presence-only"
        })
      ).toThrow("INVALID_APPLICATION_ID");
    }
  );

  it("rejects an invalid target guild snowflake", () => {
    expect(() =>
      buildVoiceRoomsInstallUrl({
        applicationId,
        guildId: "target-server",
        profile: "presence-only"
      })
    ).toThrow("INVALID_GUILD_ID");
  });

  it("rejects an unsupported profile", () => {
    expect(() =>
      buildVoiceRoomsInstallUrl({
        applicationId,
        guildId,
        profile: "administrator" as "presence-only"
      })
    ).toThrow("INVALID_VOICE_INSTALL_PROFILE");
  });
});
