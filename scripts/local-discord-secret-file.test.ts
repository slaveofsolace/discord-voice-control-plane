import { describe, expect, it } from "vitest";

import {
  parseLocalDiscordSecrets,
  serializeLocalDiscordSecrets
} from "./local-discord-secret-file.js";

describe("local Discord secret file", () => {
  it("round-trips values without exposing an unquoted assignment format", () => {
    const secrets = {
      DISCORD_BOT_TOKEN: "test.bot.token",
      CONTROL_DISCORD_CLIENT_SECRET: "test-control-secret"
    };

    expect(parseLocalDiscordSecrets(serializeLocalDiscordSecrets(secrets))).toEqual(secrets);
  });

  it("rejects missing, duplicate, empty, or extra fields", () => {
    expect(() => parseLocalDiscordSecrets('DISCORD_BOT_TOKEN="test"\n')).toThrow(
      "INVALID_LOCAL_DISCORD_SECRET_FILE"
    );
    expect(() =>
      parseLocalDiscordSecrets(
        'DISCORD_BOT_TOKEN="test"\nDISCORD_BOT_TOKEN="again"\nCONTROL_DISCORD_CLIENT_SECRET="test"\n'
      )
    ).toThrow("INVALID_LOCAL_DISCORD_SECRET_FILE");
    expect(() =>
      parseLocalDiscordSecrets('DISCORD_BOT_TOKEN=""\nCONTROL_DISCORD_CLIENT_SECRET="test"\n')
    ).toThrow("INVALID_LOCAL_DISCORD_SECRET_FILE");
    expect(() =>
      parseLocalDiscordSecrets(
        'DISCORD_BOT_TOKEN="test"\nCONTROL_DISCORD_CLIENT_SECRET="test"\nEXTRA="test"\n'
      )
    ).toThrow("INVALID_LOCAL_DISCORD_SECRET_FILE");
  });
});
