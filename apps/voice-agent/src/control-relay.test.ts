import { describe, expect, it } from "vitest";

import {
  authorizeControlRelayMessage,
  type ControlRelayConfig,
  type ControlRelayMessage
} from "./control-relay.js";

const ids = {
  app: "100000000000000001",
  guild: "100000000000000002",
  channel: "100000000000000003",
  operator: "100000000000000004",
  elevated: "100000000000000005",
  operatorRole: "100000000000000006",
  elevatedRole: "100000000000000007",
  message: "100000000000000008"
};

const config: ControlRelayConfig = {
  applicationId: ids.app,
  channelId: ids.channel,
  deploymentId: "test",
  elevatedRoleIds: new Set([ids.elevatedRole]),
  elevatedUserIds: new Set([ids.elevated]),
  guildId: ids.guild,
  operatorRoleIds: new Set([ids.operatorRole]),
  operatorUserIds: new Set([ids.operator]),
  tenantId: "test"
};

function message(overrides: Partial<ControlRelayMessage> = {}): ControlRelayMessage {
  return {
    actorRoleIds: [],
    actorUserId: ids.operator,
    applicationId: ids.app,
    attachmentCount: 0,
    bot: false,
    channelId: ids.channel,
    content: "ordinary relay text",
    edited: false,
    embedCount: 0,
    guildId: ids.guild,
    messageId: ids.message,
    thread: false,
    webhook: false,
    ...overrides
  };
}

describe("private control relay intake", () => {
  it("accepts exact users and roles in only the locked guild and channel", () => {
    expect(authorizeControlRelayMessage(message(), config).request).toMatchObject({
      operation: "create",
      actor_user_id: ids.operator,
      control_guild_id: ids.guild,
      control_channel_id: ids.channel
    });
    expect(
      authorizeControlRelayMessage(
        message({ actorUserId: "100000000000000099", actorRoleIds: [ids.operatorRole] }),
        config
      ).request.actor_role_ids
    ).toContain(ids.operatorRole);
    expect(() =>
      authorizeControlRelayMessage(message({ guildId: "100000000000000099" }), config)
    ).toThrow("WRONG_CONTROL_GUILD");
    expect(() =>
      authorizeControlRelayMessage(message({ channelId: "100000000000000099" }), config)
    ).toThrow("WRONG_CONTROL_RELAY_CHANNEL");
  });

  it.each([
    ["bot", { bot: true }],
    ["webhook", { webhook: true }],
    ["edit", { edited: true }],
    ["attachment", { attachmentCount: 1 }],
    ["embed", { embedCount: 1 }],
    ["thread", { thread: true }]
  ])("rejects %s sources", (_name, override) => {
    expect(() => authorizeControlRelayMessage(message(override), config)).toThrow();
  });

  it("requires explicit authorization and elevation independently", () => {
    expect(() =>
      authorizeControlRelayMessage(message({ actorUserId: "100000000000000099" }), config)
    ).toThrow("RELAY_ACTOR_UNAUTHORIZED");
    expect(() =>
      authorizeControlRelayMessage(message({ content: "!voice ban 100000000000000099" }), config)
    ).toThrow("ELEVATED_OPERATOR_REQUIRED");
    expect(
      authorizeControlRelayMessage(
        message({ actorUserId: ids.elevated, content: "!v ban 100000000000000099" }),
        config
      ).parsed
    ).toMatchObject({ risk: "ELEVATED", parsedCommand: { name: "ban" } });
  });

  it("maps all parser failures to the stable ingress result code", () => {
    expect(() =>
      authorizeControlRelayMessage(message({ content: "hello @everyone" }), config)
    ).toThrow("INVALID_RELAY_GRAMMAR");
    expect(() => authorizeControlRelayMessage(message({ content: "   " }), config)).toThrow(
      "INVALID_RELAY_GRAMMAR"
    );
  });
});
