import { resolve } from "node:path";

import { AgentClient } from "@discord-vc-control/agent-client";
import { userRpcEnvironmentSchema } from "@discord-vc-control/config";
import {
  type AgentBootstrap,
  type CommandAck,
  type CommandEnvelope
} from "@discord-vc-control/contracts";
import { redactSecrets } from "@discord-vc-control/security";

import { DiscordIpcClient } from "./discord-ipc.js";
import { DiscordRpcSession } from "./discord-rpc-session.js";
import { WindowsClipboardDraftHandoff } from "./draft-handoff.js";
import { ensureDashboardSecret, LocalRelayDashboard } from "./dashboard.js";
import { EncryptedRelayQueue } from "./relay-queue.js";
import { ProfileRuntimeLock } from "./profile-lock.js";
import { UserRpcController } from "./user-rpc-controller.js";

const environment = userRpcEnvironmentSchema.parse(process.env);
if (process.platform !== "win32") throw new Error("USER_RPC_AGENT_REQUIRES_WINDOWS");
const port = Number(process.env.PORT ?? "8081");
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("INVALID_PORT");

const secrets = [
  environment.USER_RPC_DISCORD_ACCESS_TOKEN,
  environment.AGENT_AUTH_SECRET,
  environment.AGENT_PREVIOUS_AUTH_SECRET ?? ""
];

function log(
  level: "error" | "info" | "warn",
  event: string,
  details: Record<string, unknown> = {}
): void {
  const safeDetails = Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      typeof value === "string" ? redactSecrets(value, secrets) : value
    ])
  );
  const line = JSON.stringify({
    level,
    event,
    service: "user-rpc-agent",
    at: new Date().toISOString(),
    ...safeDetails
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

const ipc = new DiscordIpcClient(environment.USER_RPC_DISCORD_APPLICATION_ID);
const rpc = new DiscordRpcSession(ipc, environment.USER_RPC_DISCORD_APPLICATION_ID);
let agentClient: AgentClient | null = null;
const receipts = new Map<string, CommandAck>();
const secretRoot = resolve(environment.USER_RPC_SECRET_ROOT);
const profileLock = await ProfileRuntimeLock.acquire(
  secretRoot,
  environment.DEPLOYMENT_ID,
  environment.USER_RPC_PROFILE_NAME
);
const relayQueue = new EncryptedRelayQueue({
  deploymentId: environment.DEPLOYMENT_ID,
  profileName: environment.USER_RPC_PROFILE_NAME,
  secretRoot,
  onStatus: (event) => agentClient?.send(event)
});
await relayQueue.initialize();
const dashboardSecret = await ensureDashboardSecret(secretRoot, environment.USER_RPC_PROFILE_NAME);

const controller = new UserRpcController({
  allowedGuildId: environment.USER_RPC_ALLOWED_GUILD_ID,
  deploymentId: environment.DEPLOYMENT_ID,
  draftHandoff: new WindowsClipboardDraftHandoff(),
  profileName: environment.USER_RPC_PROFILE_NAME,
  relayQueue,
  rpc,
  onStatus: (status) => agentClient?.send(status)
});

async function applyBootstrap(bootstrap: AgentBootstrap): Promise<void> {
  await controller.setTarget(bootstrap.authorized_target);
  await controller.applyDesiredState(bootstrap.desired_connected, bootstrap.paused);
}

async function handleControlCommand(command: CommandEnvelope, duplicate: boolean): Promise<void> {
  if (duplicate) {
    const receipt = receipts.get(command.command_id);
    if (receipt !== undefined) {
      agentClient?.send({ ...receipt, duplicate: true, occurred_at: Date.now() });
    }
    return;
  }
  const receipt = await controller.execute(command);
  receipts.set(command.command_id, receipt);
  agentClient?.send(receipt);
}

agentClient = new AgentClient({
  deploymentId: environment.DEPLOYMENT_ID,
  tenantId: environment.TENANT_ID,
  endpoint: environment.AGENT_ENDPOINT,
  keyId: environment.AGENT_KEY_ID,
  secret: environment.AGENT_AUTH_SECRET,
  ...(environment.AGENT_PREVIOUS_KEY_ID === undefined
    ? {}
    : { previousKeyId: environment.AGENT_PREVIOUS_KEY_ID }),
  ...(environment.AGENT_PREVIOUS_AUTH_SECRET === undefined
    ? {}
    : { previousSecret: environment.AGENT_PREVIOUS_AUTH_SECRET }),
  onBlocked: (code) => controller.handleControlPlaneFailure(code),
  onBootstrap: applyBootstrap,
  onCommand: handleControlCommand
});

const dashboard = new LocalRelayDashboard({ controller, port, secret: dashboardSecret.secret });

await controller.initialize(
  environment.USER_RPC_DISCORD_ACCESS_TOKEN,
  environment.USER_RPC_EXPECTED_USER_ID
);
await agentClient.start();
agentClient.send(controller.status);
await dashboard.start();
log("info", "relay_dashboard_ready", {
  url: `http://127.0.0.1:${port}/`,
  dashboard_secret_path: dashboardSecret.path,
  queue_state_path: relayQueue.statePath,
  profile: environment.USER_RPC_PROFILE_NAME
});

const heartbeatTimer = setInterval(() => {
  agentClient?.send({
    type: "heartbeat",
    deployment_id: environment.DEPLOYMENT_ID,
    sent_at: Date.now(),
    gateway_sequence: null
  });
  agentClient?.send(controller.status);
  void relayQueue.expire();
  const cutoff = Date.now() - 24 * 60 * 60_000;
  for (const [commandId, receipt] of receipts) {
    if (receipt.occurred_at < cutoff) receipts.delete(commandId);
  }
}, 15_000);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log("info", "shutdown_started", { signal });
  clearInterval(heartbeatTimer);
  await controller.shutdown();
  agentClient?.send(controller.status);
  agentClient?.close();
  await dashboard.close();
  await profileLock.close();
  log("info", "shutdown_complete");
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
