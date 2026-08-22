import { describe, expect, it } from "vitest";

import { controlApplicationCommand } from "./command-data.js";

describe("control command definition", () => {
  it("contains only the fixed control actions", () => {
    expect(controlApplicationCommand.options.map((option) => option.name)).toEqual([
      "status",
      "join",
      "leave",
      "reconnect",
      "pause",
      "resume",
      "relay",
      "diagnostics",
      "audit"
    ]);
  });

  it("does not accept a guild or channel argument for join", () => {
    expect(
      controlApplicationCommand.options.find((option) => option.name === "join")
    ).not.toHaveProperty("options");
  });
});
