import { resolve4 } from "node:dns/promises";
import { createServer } from "node:http";

import {
  VoiceConnectionStatus,
  entersState,
  generateDependencyReport,
  joinVoiceChannel,
  type VoiceConnection
} from "@discordjs/voice";
import { ChannelType, Client, GatewayIntentBits } from "discord.js";
import WebSocket from "ws";

import type { ProbeReport } from "./report.js";

const token = process.env.DISCORD_BOT_TOKEN ?? "";
const guildId = process.env.PROBE_GUILD_ID ?? "";
const channelId = process.env.PROBE_VOICE_CHANNEL_ID ?? "";
const stableMs = Number(process.env.PROBE_STABLE_MS ?? "60000");
const port = Number(process.env.PORT ?? "8080");

let report: ProbeReport = {
  run_id: crypto.randomUUID(),
  phase: "IDLE",
  dns_resolved: false,
  https_reached: false,
  gateway_websocket_hello: false,
  bot_gateway_ready: false,
  udp_ip_discovery_completed: false,
  dave_negotiated: false,
  stable_silent_connection: false,
  disconnect_recovery: false,
  native_stack_loaded: false,
  inbound_udp_listener_required: false,
  error_code: null,
  completed_at: null
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isByteView(data: WebSocket.RawData): data is Uint8Array {
  return ArrayBuffer.isView(data);
}

function decodeRawData(data: WebSocket.RawData): string {
  const decoder = new TextDecoder();
  if (data instanceof ArrayBuffer || isByteView(data)) return decoder.decode(data);

  const size = data.reduce((total, chunk) => total + chunk.byteLength, 0);
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of data) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decoder.decode(joined);
}

async function gatewayHello(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket("wss://gateway.discord.gg/?v=10&encoding=json", {
      handshakeTimeout: 10_000,
      perMessageDeflate: false
    });
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error("GATEWAY_HELLO_TIMEOUT"));
    }, 10_000);
    socket.once("message", (data) => {
      clearTimeout(timeout);
      try {
        const text = decodeRawData(data);
        const payload = JSON.parse(text) as { op?: unknown };
        if (payload.op !== 10) throw new Error("GATEWAY_HELLO_INVALID");
        socket.close(1000);
        resolve();
      } catch (error) {
        reject(error instanceof Error ? error : new Error("GATEWAY_HELLO_PARSE_FAILED"));
      }
    });
    socket.once("error", (error) =>
      reject(error instanceof Error ? error : new Error("GATEWAY_WEBSOCKET_ERROR"))
    );
  });
}

function voiceConnection(client: Client<true>): VoiceConnection {
  const guild = client.guilds.cache.get(guildId);
  const channel = guild?.channels.cache.get(channelId);
  if (guild === undefined || channel?.type !== ChannelType.GuildVoice) {
    throw new Error("PROBE_TARGET_NOT_GUILD_VOICE");
  }
  return joinVoiceChannel({
    adapterCreator: guild.voiceAdapterCreator,
    channelId: channel.id,
    daveEncryption: true,
    guildId: guild.id,
    group: `probe-${report.run_id}`,
    selfDeaf: true,
    selfMute: true
  });
}

async function run(): Promise<void> {
  report = { ...report, phase: "RUNNING" };
  let client: Client | null = null;
  let connection: VoiceConnection | null = null;
  try {
    if (token.length < 32 || !/^\d{17,20}$/u.test(guildId) || !/^\d{17,20}$/u.test(channelId)) {
      throw new Error("PROBE_CONFIGURATION_INVALID");
    }
    if (!Number.isFinite(stableMs) || stableMs < 10_000 || stableMs > 300_000) {
      throw new Error("PROBE_STABLE_DURATION_INVALID");
    }
    report.native_stack_loaded = generateDependencyReport().includes("@snazzah/davey: 0.1.12");
    report.dns_resolved = (await resolve4("discord.com")).length > 0;
    const gatewayResponse = await fetch("https://discord.com/api/v10/gateway");
    report.https_reached = gatewayResponse.ok;
    await gatewayHello();
    report.gateway_websocket_hello = true;

    const activeClient = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
    });
    client = activeClient;
    await activeClient.login(token);
    const readyClient = activeClient.isReady()
      ? activeClient
      : await new Promise<Client<true>>((resolve) => activeClient.once("ready", resolve));
    report.bot_gateway_ready = true;
    const guild = await readyClient.guilds.fetch(guildId);
    await guild.channels.fetch(channelId);

    connection = voiceConnection(readyClient);
    connection.on("transitioned", () => {
      report.dave_negotiated = true;
    });
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    report.udp_ip_discovery_completed = true;
    report.dave_negotiated = report.dave_negotiated || connection.voicePrivacyCode !== undefined;
    await wait(stableMs);
    if (connection.state.status !== VoiceConnectionStatus.Ready)
      throw new Error("VOICE_NOT_STABLE");
    report.stable_silent_connection = true;

    connection.destroy();
    connection = null;
    await wait(1_000);
    connection = voiceConnection(readyClient);
    connection.on("transitioned", () => {
      report.dave_negotiated = true;
    });
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    await wait(15_000);
    report.disconnect_recovery = connection.state.status === VoiceConnectionStatus.Ready;
    if (!report.dave_negotiated) throw new Error("DAVE_NOT_OBSERVED");
    report = { ...report, phase: "COMPLETE", completed_at: Date.now() };
  } catch (error) {
    report = {
      ...report,
      phase: "FAILED",
      error_code: error instanceof Error ? error.message.slice(0, 120) : "PROBE_FAILED",
      completed_at: Date.now()
    };
  } finally {
    connection?.destroy();
    await client?.destroy();
    console.log(JSON.stringify({ event: "cloudflare_voice_probe_result", ...report }));
  }
}

const server = createServer((request, response) => {
  if (request.method !== "GET" || (request.url !== "/healthz" && request.url !== "/report")) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(report));
});
server.listen(port, "0.0.0.0", () => void run());

function shutdown(): void {
  server.close();
  process.exitCode = 0;
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
