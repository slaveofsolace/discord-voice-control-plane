import { spawnSync } from "node:child_process";

export interface DraftHandoff {
  stage(text: string): Promise<void> | void;
}

export class WindowsClipboardDraftHandoff implements DraftHandoff {
  stage(text: string): void {
    if (process.platform !== "win32") throw new Error("LOCAL_DRAFT_WINDOWS_ONLY");
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Set-Clipboard -Value ([Console]::In.ReadToEnd())"
      ],
      { input: text, encoding: "utf8", stdio: ["pipe", "ignore", "ignore"], windowsHide: true }
    );
    if (result.status !== 0) throw new Error("LOCAL_DRAFT_CLIPBOARD_FAILED");
  }
}
