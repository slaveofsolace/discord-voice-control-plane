/* eslint-disable security/detect-non-literal-fs-filename -- paths are fixed repository-relative source fixtures */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

async function source(path: string): Promise<string> {
  return readFile(resolve(root, path), "utf8");
}

describe("authorized user relay negative source checks", () => {
  it("contains no user Gateway, user-token, send-message, keystroke, or audio implementation", async () => {
    const files = [
      "apps/user-rpc-agent/package.json",
      "apps/user-rpc-agent/src/index.ts",
      "apps/user-rpc-agent/src/discord-ipc.ts",
      "apps/user-rpc-agent/src/discord-rpc-session.ts",
      "apps/user-rpc-agent/src/user-rpc-controller.ts",
      "apps/user-rpc-agent/src/dashboard.ts",
      "apps/user-rpc-agent/src/draft-handoff.ts"
    ];
    const combined = (await Promise.all(files.map(source))).join("\n");
    for (const forbidden of [
      /GatewayIntentBits/u,
      /@discordjs\/voice/u,
      /discord\.js/u,
      /wss:\/\/gateway\.discord/u,
      /\/channels\/[^\s]+\/messages/u,
      /robotjs|nut-js|SendKeys|keybd_event|pynput/iu,
      /powershell\.exe/iu,
      /createAudio|AudioPlayer|VoiceReceiver|subscribeReceiver/iu
    ]) {
      expect(combined).not.toMatch(forbidden);
    }
  });

  it("never claims a Discord delivery ID for the manual user path", async () => {
    const combined = [
      await source("apps/user-rpc-agent/src/user-rpc-controller.ts"),
      await source("apps/user-rpc-agent/src/relay-queue.ts"),
      await source("apps/user-rpc-agent/src/dashboard.ts")
    ].join("\n");
    expect(combined).not.toContain("target_message_id");
    expect(combined).not.toContain("OWNER_VERIFIED_DELIVERY");
  });

  it("keeps agent authentication material out of relay-only bot containers", async () => {
    const host = await source("apps/voice-host-worker/src/index.ts");
    const containerEnvironment = host.slice(
      host.indexOf("const envVars"),
      host.indexOf("await this.startAndWaitForPorts")
    );
    expect(containerEnvironment).not.toContain("AGENT_AUTH_SECRET: configuration.agentAuthSecret");
    expect(containerEnvironment).toContain(
      "envVars.AGENT_AUTH_SECRET = configuration.agentAuthSecret"
    );
    expect(host).toContain('env.CONTROL_RELAY_ONLY === "true"');
  });
});
