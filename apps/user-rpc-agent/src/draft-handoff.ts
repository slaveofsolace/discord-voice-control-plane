import { spawnSync } from "node:child_process";

export interface DraftHandoff {
  stage(text: string): Promise<void> | void;
}

export type ClipboardRunner = (
  command: string,
  arguments_: readonly string[],
  options: {
    encoding: "utf8";
    input: string;
    stdio: ["pipe", "ignore", "ignore"];
    timeout: number;
    windowsHide: true;
  }
) => { error?: Error; status: number | null };

export class WindowsClipboardDraftHandoff implements DraftHandoff {
  constructor(
    private readonly runner: ClipboardRunner = (command, arguments_, options) =>
      spawnSync(command, [...arguments_], options),
    private readonly platform = process.platform
  ) {}

  stage(text: string): void {
    if (this.platform !== "win32") throw new Error("LOCAL_DRAFT_WINDOWS_ONLY");
    if (Buffer.byteLength(text, "utf8") > 8_192) throw new Error("LOCAL_DRAFT_TOO_LARGE");
    const result = this.runner("C:\\Windows\\System32\\clip.exe", [], {
      input: text,
      encoding: "utf8",
      stdio: ["pipe", "ignore", "ignore"],
      timeout: 2_000,
      windowsHide: true
    });
    if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") {
      throw new Error("LOCAL_DRAFT_CLIPBOARD_TIMEOUT");
    }
    if (result.status !== 0) throw new Error("LOCAL_DRAFT_CLIPBOARD_FAILED");
  }
}
