import { describe, expect, it } from "vitest";

import { authorizeInteraction } from "./authorization.js";
import type { DiscordInteraction, Env } from "./types.js";

const operatorId = "100000000000000004";
const operatorRoleId = "100000000000000005";

const environment = {
  CONTROL_DISCORD_APPLICATION_ID: "100000000000000001",
  CONTROL_GUILD_ID: "100000000000000002",
  CONTROL_CHANNEL_IDS: "100000000000000003",
  CONTROL_OPERATOR_USER_IDS: operatorId,
  CONTROL_OPERATOR_ROLE_IDS: "",
  CONTROL_ELEVATED_USER_IDS: operatorId,
  CONTROL_ELEVATED_ROLE_IDS: ""
} as unknown as Env;

const interaction: DiscordInteraction = {
  id: "100000000000000010",
  application_id: environment.CONTROL_DISCORD_APPLICATION_ID,
  type: 2,
  token: "transient",
  guild_id: environment.CONTROL_GUILD_ID,
  channel_id: "100000000000000003",
  member: { user: { id: operatorId }, roles: [] }
};

describe("control authorization", () => {
  it.each([
    [{ ...interaction, application_id: "100000000000000099" }, "WRONG_APPLICATION"],
    [{ ...interaction, guild_id: "100000000000000099" }, "WRONG_CONTROL_GUILD"],
    [{ ...interaction, channel_id: "100000000000000099" }, "WRONG_CONTROL_CHANNEL"],
    [
      { ...interaction, member: { user: { id: "100000000000000099" }, roles: [] } },
      "UNAUTHORIZED_OPERATOR"
    ],
    [
      {
        id: interaction.id,
        application_id: interaction.application_id,
        type: interaction.type,
        token: interaction.token,
        guild_id: environment.CONTROL_GUILD_ID,
        channel_id: "100000000000000003"
      },
      "MISSING_ACTOR"
    ]
  ])("rejects an invalid control context with %s", (candidate, code) => {
    expect(authorizeInteraction(candidate, "status", environment)).toEqual({
      allowed: false,
      code
    });
  });

  it("accepts a configured operator role", () => {
    const roleEnvironment = {
      ...environment,
      CONTROL_OPERATOR_USER_IDS: "",
      CONTROL_OPERATOR_ROLE_IDS: operatorRoleId
    };
    expect(
      authorizeInteraction(
        { ...interaction, member: { user: { id: operatorId }, roles: [operatorRoleId] } },
        "join",
        roleEnvironment
      )
    ).toMatchObject({ allowed: true, actorUserId: operatorId });
  });

  it("requires the elevated allowlist for reconnect and audit", () => {
    const normalOnly = {
      ...environment,
      CONTROL_ELEVATED_USER_IDS: "",
      CONTROL_ELEVATED_ROLE_IDS: ""
    };
    expect(authorizeInteraction(interaction, "join", normalOnly)).toMatchObject({ allowed: true });
    expect(authorizeInteraction(interaction, "reconnect", normalOnly)).toEqual({
      allowed: false,
      code: "ELEVATED_OPERATOR_REQUIRED"
    });
    expect(authorizeInteraction(interaction, "audit", normalOnly)).toEqual({
      allowed: false,
      code: "ELEVATED_OPERATOR_REQUIRED"
    });
  });
});
