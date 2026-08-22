import { describe, expect, it } from "vitest";

import {
  asVoiceAdminSubcommand,
  requiresManageChannels,
  voiceAdminSubcommands
} from "./voice-admin-authorization.js";

describe("voice administration authorization", () => {
  it("requires Manage Channels for managed-room administration", () => {
    for (const subcommand of voiceAdminSubcommands) {
      expect(requiresManageChannels(subcommand)).toBe(subcommand !== "authorize-target");
    }
  });

  it("rejects unknown administration subcommands", () => {
    expect(() => asVoiceAdminSubcommand("adopt-channel")).toThrow("UNKNOWN_VOICE_ADMIN_COMMAND");
  });
});
