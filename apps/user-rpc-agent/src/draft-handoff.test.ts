import { describe, expect, it, vi } from "vitest";

import { WindowsClipboardDraftHandoff, type ClipboardRunner } from "./draft-handoff.js";

describe("bounded Windows clipboard handoff", () => {
  it("uses only the fixed clip.exe path with bounded input and timeout", () => {
    const runner = vi.fn<ClipboardRunner>().mockReturnValue({ status: 0 });
    new WindowsClipboardDraftHandoff(runner, "win32").stage("manual draft");
    expect(runner).toHaveBeenCalledWith("C:\\Windows\\System32\\clip.exe", [], {
      input: "manual draft",
      encoding: "utf8",
      stdio: ["pipe", "ignore", "ignore"],
      timeout: 2_000,
      windowsHide: true
    });
  });

  it("distinguishes failure, timeout, platform, and size errors", () => {
    const failed = vi.fn<ClipboardRunner>().mockReturnValue({ status: 1 });
    expect(() => new WindowsClipboardDraftHandoff(failed, "win32").stage("draft")).toThrow(
      "LOCAL_DRAFT_CLIPBOARD_FAILED"
    );
    const timeout = vi.fn<ClipboardRunner>().mockReturnValue({
      error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }),
      status: null
    });
    expect(() => new WindowsClipboardDraftHandoff(timeout, "win32").stage("draft")).toThrow(
      "LOCAL_DRAFT_CLIPBOARD_TIMEOUT"
    );
    expect(() => new WindowsClipboardDraftHandoff(failed, "linux").stage("draft")).toThrow(
      "LOCAL_DRAFT_WINDOWS_ONLY"
    );
    expect(() => new WindowsClipboardDraftHandoff(failed, "win32").stage("x".repeat(9000))).toThrow(
      "LOCAL_DRAFT_TOO_LARGE"
    );
  });
});
