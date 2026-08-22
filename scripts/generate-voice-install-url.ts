import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildVoiceRoomsInstallUrl, type VoiceInstallProfile } from "./discord-install-url.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}

const profile = required("VOICE_INSTALL_PROFILE") as VoiceInstallProfile;
const url = buildVoiceRoomsInstallUrl({
  applicationId: required("VOICE_ROOMS_APPLICATION_ID"),
  guildId: required("AUTHORIZED_TARGET_GUILD_ID"),
  profile
});
const runtimeDirectory = resolve(process.cwd(), ".runtime");
const outputName = process.env.VOICE_INSTALL_OUTPUT_NAME?.trim() || "voice-rooms-target.url";
if (!/^[a-z0-9][a-z0-9._-]*\.url$/iu.test(outputName)) {
  throw new Error("INVALID_VOICE_INSTALL_OUTPUT_NAME");
}

// Both paths are resolved beneath the current repository and the output name is allowlisted above.
// eslint-disable-next-line security/detect-non-literal-fs-filename
await mkdir(runtimeDirectory, { recursive: true });
// eslint-disable-next-line security/detect-non-literal-fs-filename
await writeFile(
  resolve(runtimeDirectory, outputName),
  `[InternetShortcut]\nURL=${url.toString()}\n`,
  { encoding: "utf8", flag: "wx", mode: 0o600 }
);
console.log(`Prepared an ignored, guild-locked ${profile} install shortcut without printing IDs.`);
