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

import { missingConnectivityGates, type ProbeReport } from "./report.js";

const token = process.env.DISCORD_BOT_TOKEN ?? "";
const guildId = process.env.PROBE_GUILD_ID ?? "";
const channelId = process.env.PROBE_VOICE_CHANNEL_ID ?? "";
const stableMs = Number(process.env.PROBE_STABLE_MS ?? "60000");
const port = Number(process.env.PORT ?? "8080");

let activeClient: Client | null = null;
let activeConnection: VoiceConnection | null = null;
let shuttingDown = false;

let report: ProbeReport = {
  run_id: crypto.randomUUID(),
  phase: "IDLE",
  dns_resolved: false,
  https_reached: false,
  gateway_websocket_hello: false,
  bot_gateway_ready: false,
  gateway_reauthentication_completed: false,
  udp_socket_created: false,
  udp_discovery_request_sent: false,
  udp_discovery_response_received: false,
  udp_ip_discovery_completed: false,
  voice_connection_established: false,
  dave_negotiated: false,
  dave_renegotiated_after_voice_rejoin: false,
  stable_silent_connection: false,
  controlled_voice_rejoin_completed: false,
  native_stack_loaded: false,
  inbound_udp_listener_required: false,
  inbound_udp_listener_opened: false,
  audio_sent_or_received: false,
  sigterm_handler_ready: true,
  sigterm_received: false,
  clean_shutdown_completed: false,
  udp_evidence_basis: null,
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

async function waitForDaveTransition(
  connection: VoiceConnection,
  allowExisting: boolean
): Promise<boolean> {
  if (allowExisting && connection.voicePrivacyCode !== undefined) return true;
  return new Promise<boolean>((resolve) => {
    const transitioned = (): void => {
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      connection.off("transitioned", transitioned);
      resolve(false);
    }, 10_000);
    connection.once("transitioned", transitioned);
  });
}

function recordVoiceReady(): void {
  report.voice_connection_established = true;
  report.udp_socket_created = true;
  report.udp_discovery_request_sent = true;
  report.udp_discovery_response_received = true;
  report.udp_ip_discovery_completed = true;
  report.udp_evidence_basis = "VOICE_READY_PROTOCOL_PRECONDITION";
}

async function run(): Promise<void> {
  report = { ...report, phase: "RUNNING" };
  try {
    if (token.length < 32 || !/^\d{17,20}$/u.test(guildId) || !/^\d{17,20}$/u.test(channelId)) {
      throw new Error("PROBE_CONFIGURATION_INVALID");
    }
    if (!Number.isFinite(stableMs) || stableMs < 10_000 || stableMs > 300_000) {
      throw new Error("PROBE_STABLE_DURATION_INVALID");
    }
    report.native_stack_loaded = generateDependencyReport().includes("@snazzah/davey: 0.1.12");
    if (!report.native_stack_loaded) throw new Error("DAVE_NATIVE_STACK_NOT_LOADED");
    report.dns_resolved = (await resolve4("discord.com")).length > 0;
    const gatewayResponse = await fetch("https://discord.com/api/v10/gateway");
    report.https_reached = gatewayResponse.ok;
    if (!report.https_reached) throw new Error(`DISCORD_HTTPS_${gatewayResponse.status}`);
    await gatewayHello();
    report.gateway_websocket_hello = true;

    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
    });
    activeClient = client;
    await client.login(token);
    const readyClient = client.isReady()
      ? client
      : await new Promise<Client<true>>((resolve) => client.once("ready", resolve));
    report.bot_gateway_ready = true;
    const guild = await readyClient.guilds.fetch(guildId);
    await guild.channels.fetch(channelId);

    activeConnection = voiceConnection(readyClient);
    const initialDave = waitForDaveTransition(activeConnection, true);
    await entersState(activeConnection, VoiceConnectionStatus.Ready, 30_000);
    recordVoiceReady();
    if (!(await initialDave)) throw new Error("DAVE_NEGOTIATION_TIMEOUT");
    report.dave_negotiated = true;
    await wait(stableMs);
    if (activeConnection.state.status !== VoiceConnectionStatus.Ready)
      throw new Error("VOICE_NOT_STABLE");
    report.stable_silent_connection = true;

    const rejoinedDave = waitForDaveTransition(activeConnection, false);
    if (!activeConnection.disconnect()) throw new Error("CONTROLLED_VOICE_DISCONNECT_REJECTED");
    if (!activeConnection.rejoin({ channelId, selfDeaf: true, selfMute: true })) {
      throw new Error("CONTROLLED_VOICE_REJOIN_REJECTED");
    }
    await entersState(activeConnection, VoiceConnectionStatus.Ready, 30_000);
    if (!(await rejoinedDave)) throw new Error("DAVE_RENEGOTIATION_TIMEOUT");
    await wait(15_000);
    if (activeConnection.state.status !== VoiceConnectionStatus.Ready) {
      throw new Error("VOICE_REJOIN_NOT_STABLE");
    }
    report.controlled_voice_rejoin_completed = true;
    report.dave_renegotiated_after_voice_rejoin = true;

    activeConnection.destroy();
    activeConnection = null;
    await client.destroy();
    const recoveryClient = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
    });
    activeClient = recoveryClient;
    await recoveryClient.login(token);
    const recoveredClient = recoveryClient.isReady()
      ? recoveryClient
      : await new Promise<Client<true>>((resolve) => recoveryClient.once("ready", resolve));
    await recoveredClient.guilds.fetch(guildId);
    report.gateway_reauthentication_completed = true;

    const missing = missingConnectivityGates(report);
    if (missing.length > 0) throw new Error(`PROBE_GATES_MISSING_${missing.join("_")}`);
    report = { ...report, phase: "COMPLETE", completed_at: Date.now() };
  } catch (error) {
    report = {
      ...report,
      phase: "FAILED",
      error_code: error instanceof Error ? error.message.slice(0, 120) : "PROBE_FAILED",
      completed_at: Date.now()
    };
  } finally {
    activeConnection?.destroy();
    activeConnection = null;
    await activeClient?.destroy();
    activeClient = null;
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

async function shutdown(signal: "SIGINT" | "SIGTERM"): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  report = { ...report, sigterm_received: signal === "SIGTERM" };
  activeConnection?.destroy();
  activeConnection = null;
  await activeClient?.destroy();
  activeClient = null;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  report = { ...report, clean_shutdown_completed: true };
  console.log(JSON.stringify({ event: "cloudflare_voice_probe_shutdown", signal, ...report }));
  process.exitCode = 0;
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
