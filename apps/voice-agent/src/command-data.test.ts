import { describe, expect, it } from "vitest";

import { voiceAdminCommand, voiceCommand } from "./command-data.js";

describe("Discord application command definitions", () => {
  it("publishes every member voice subcommand", () => {
    const names = voiceCommand.toJSON().options?.map((option) => option.name);
    expect(names).toEqual([
      "info",
      "name",
      "size",
      "lock",
      "unlock",
      "permit",
      "unpermit",
      "kick",
      "ban",
      "unban",
      "reset",
      "claim"
    ]);
  });

  it("publishes only the fixed administration surface", () => {
    const command = voiceAdminCommand.toJSON();
    const names = command.options?.map((option) => option.name);
    expect(names).toEqual(["setup", "status", "enable", "disable", "authorize-target"]);
    expect(command.default_member_permissions).toBeUndefined();
  });
});
