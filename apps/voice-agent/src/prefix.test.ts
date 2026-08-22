import { describe, expect, it } from "vitest";

import { parsePrefixCommand } from "./prefix.js";

describe("prefix parser", () => {
  it("supports both exact prefixes", () => {
    expect(parsePrefixCommand("!voice info")).toEqual({ subcommand: "info" });
    expect(parsePrefixCommand("!v size unlimited")).toEqual({
      subcommand: "size",
      argument: "unlimited"
    });
  });

  it("accepts mentions and snowflakes without fuzzy names", () => {
    expect(parsePrefixCommand("!voice permit <@100000000000000001>")).toEqual({
      subcommand: "permit",
      userId: "100000000000000001"
    });
    expect(parsePrefixCommand("!v kick 100000000000000002")).toEqual({
      subcommand: "kick",
      userId: "100000000000000002"
    });
    expect(() => parsePrefixCommand("!voice ban some-user")).toThrow("USER_MENTION_OR_ID_REQUIRED");
  });

  it("does not match unrelated prefixes", () => {
    expect(parsePrefixCommand("!voices info")).toBeNull();
    expect(parsePrefixCommand("hello")).toBeNull();
  });
});
