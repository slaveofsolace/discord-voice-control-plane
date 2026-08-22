import {
  commandLifetimeMs,
  controlActionSchema,
  parseActionPayload,
  type CommandAck,
  type ControlAction,
  type UnsignedCommandEnvelope
} from "@discord-vc-control/contracts";
import { sanitizeRelayText, sha256Hex, signCommandEnvelope } from "@discord-vc-control/security";

import { AgentSession } from "./agent-session.js";
import { recentAudit, purgeExpiredAudit, writeAudit } from "./audit.js";
import { authorizeInteraction } from "./authorization.js";
import {
  deferredInteractionResponse,
  editInteractionResponse,
  interactionResponse,
  verifyDiscordRequest
} from "./discord.js";
import type { DiscordInteraction, Env, SessionStatus } from "./types.js";

export { AgentSession };

function sessionStub(env: Env): DurableObjectStub {
  return env.AGENT_SESSION.get(env.AGENT_SESSION.idFromName(env.DEPLOYMENT_ID));
}

function parseSubcommand(interaction: DiscordInteraction): {
  action: ControlAction;
  values: Record<string, string | number | boolean>;
} {
  if (interaction.data?.name !== "vc") throw new Error("UNKNOWN_COMMAND");
  const subcommand = interaction.data.options?.[0];
  const action = controlActionSchema.parse(subcommand?.name);
  const values = Object.fromEntries(
    (subcommand?.options ?? [])
      .filter((option) => option.value !== undefined)
      .map((option) => {
        if (option.value === undefined) throw new Error("MISSING_OPTION_VALUE");
        return [option.name, option.value];
      })
  );
  return { action, values };
}

function summarizeStatus(status: SessionStatus): string {
  const observed = status.status;
  const heartbeat = status.lastHeartbeat;
  const heartbeatAge =
    heartbeat === null ? "never" : `${Math.max(0, Date.now() - heartbeat)} ms ago`;
  const agentHealth = observed?.last_health_at;
  return [
    `Agent: ${status.agentConnected ? (status.heartbeatStale ? "connected but stale" : "connected") : "disconnected"}`,
    `Desired: ${observed?.desired_connected ? "connected" : "disconnected"}`,
    `State: ${observed?.observed_state ?? "UNKNOWN"}`,
    `Gateway: ${observed?.gateway_connected ? "connected" : "disconnected"}`,
    `Voice/UDP/DAVE: ${observed?.voice_connected ? "yes" : "no"}/${observed?.udp_established ? "yes" : "no"}/${observed?.dave_established ? "yes" : "no"}`,
    `Target: ${observed?.target_guild_id ?? "unset"}/${observed?.target_channel_id ?? "unset"}`,
    `Circuit: ${observed?.circuit_open ? "open" : "closed"}`,
    `Retries: ${observed?.retry_count ?? 0}`,
    `Pending: ${status.pendingCommands}`,
    `Heartbeat received: ${heartbeat === null ? "never" : new Date(heartbeat).toISOString()} (${heartbeatAge})`,
    `Agent-reported health: ${agentHealth === undefined ? "never" : new Date(agentHealth).toISOString()}`,
    `Last error: ${observed?.last_error_code ?? status.lastError ?? "none"}`
  ].join("\n");
}

async function getSessionStatus(env: Env): Promise<SessionStatus> {
  const response = await sessionStub(env).fetch("https://session/status");
  if (!response.ok) throw new Error(`SESSION_STATUS_${response.status}`);
  return response.json<SessionStatus>();
}

async function waitForReceipt(env: Env, commandId: string): Promise<CommandAck | null> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await sessionStub(env).fetch(`https://session/receipts/${commandId}`);
    if (response.ok) return response.json<CommandAck>();
    if (response.status !== 404) throw new Error(`RECEIPT_${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

async function dispatchCommand(
  interaction: DiscordInteraction,
  action: ControlAction,
  values: Record<string, string | number | boolean>,
  actorUserId: string,
  env: Env
): Promise<void> {
  let payload: Record<string, unknown> = {};
  let contentHash: string | undefined;
  let contentLength: number | undefined;
  if (action === "relay") {
    const text = sanitizeRelayText(String(values.text ?? ""), {
      rejectedPrefixes: ["!voice", "!v"]
    });
    payload = { text };
    contentHash = await sha256Hex(text);
    contentLength = text.length;
  } else if (action === "audit") {
    payload = { limit: Number(values.limit ?? 10) };
  }
  parseActionPayload(action, payload);
  const controlGuildId = interaction.guild_id;
  const controlChannelId = interaction.channel_id;
  if (controlGuildId === undefined || controlChannelId === undefined) {
    throw new Error("MISSING_CONTROL_CONTEXT");
  }
  const now = Date.now();
  const unsigned: UnsignedCommandEnvelope = {
    version: 1,
    command_id: crypto.randomUUID(),
    issued_at: now,
    expires_at: now + commandLifetimeMs,
    nonce: crypto.randomUUID(),
    actor_user_id: actorUserId,
    control_guild_id: controlGuildId,
    control_channel_id: controlChannelId,
    deployment_id: env.DEPLOYMENT_ID,
    tenant_id: env.TENANT_ID,
    action,
    payload,
    kid: env.AGENT_KEY_ID
  };
  const envelope = await signCommandEnvelope(unsigned, env.AGENT_AUTH_SECRET);
  try {
    await writeAudit(env, envelope, {
      ...(contentHash === undefined ? {} : { contentHash }),
      ...(contentLength === undefined ? {} : { contentLength }),
      resultCode: "QUEUED"
    });
  } catch {
    await sessionStub(env).fetch("https://session/audit-outbox", {
      method: "POST",
      body: JSON.stringify({
        deployment_id: envelope.deployment_id,
        tenant_id: envelope.tenant_id,
        command_id: envelope.command_id,
        actor_user_id: envelope.actor_user_id,
        control_guild_id: envelope.control_guild_id,
        control_channel_id: envelope.control_channel_id,
        action,
        content_hash: contentHash ?? null,
        content_length: contentLength ?? null,
        result_code: "QUEUED",
        target_message_id: null,
        occurred_at: now,
        expires_at: now + 30 * 24 * 60 * 60_000
      })
    });
  }
  const queued = await sessionStub(env).fetch("https://session/commands", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(envelope)
  });
  if (!queued.ok) throw new Error(`COMMAND_QUEUE_${queued.status}`);
  const receipt = await waitForReceipt(env, envelope.command_id);
  const content = receipt
    ? `${receipt.accepted ? "Accepted" : "Rejected"}: ${receipt.summary} (${receipt.result_code})`
    : `Queued ${action}. The agent did not acknowledge within 10 seconds; use /vc status.`;
  await editInteractionResponse({
    applicationId: interaction.application_id,
    interactionToken: interaction.token,
    content
  });
}

async function handleInteraction(
  request: Request,
  env: Env,
  context: ExecutionContext
): Promise<Response> {
  const rawBody = await request.text();
  if (!(await verifyDiscordRequest(request, rawBody, env.CONTROL_DISCORD_PUBLIC_KEY))) {
    return new Response("Invalid request signature", { status: 401 });
  }
  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(rawBody) as DiscordInteraction;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (interaction.type === 1) return Response.json({ type: 1 });
  if (interaction.type !== 2) return interactionResponse("Unsupported interaction type.");
  let parsed: ReturnType<typeof parseSubcommand>;
  try {
    parsed = parseSubcommand(interaction);
  } catch {
    return interactionResponse("Unknown control command.");
  }
  const authorization = authorizeInteraction(interaction, parsed.action, env);
  if (!authorization.allowed) return interactionResponse(`Denied: ${authorization.code}.`);
  if (parsed.action === "status") {
    try {
      return interactionResponse(summarizeStatus(await getSessionStatus(env)));
    } catch {
      return interactionResponse(
        "Control session unavailable. No secrets or raw traces are exposed."
      );
    }
  }
  if (parsed.action === "audit") {
    const limit = Number(parsed.values.limit ?? 10);
    const events = await recentAudit(env, limit);
    if (events.length === 0) return interactionResponse("No retained audit events.");
    const lines: string[] = [];
    let length = 0;
    for (const event of events) {
      const line = [
        new Date(event.occurred_at).toISOString(),
        event.action,
        `actor=${event.actor_user_id}`,
        `result=${event.result_code}`,
        event.content_length === null ? null : `length=${event.content_length}`,
        event.content_hash === null ? null : `sha256=${event.content_hash.slice(0, 12)}`,
        event.target_message_id === null ? null : `message=${event.target_message_id}`
      ]
        .filter((part) => part !== null)
        .join(" ");
      if (length + line.length + 1 > 1_850) break;
      lines.push(line);
      length += line.length + 1;
    }
    const suffix =
      lines.length < events.length
        ? `\nShowing ${lines.length} of ${events.length} retained rows due to Discord's message limit.`
        : "";
    return interactionResponse(`${lines.join("\n")}${suffix}`);
  }
  context.waitUntil(
    dispatchCommand(
      interaction,
      parsed.action,
      parsed.values,
      authorization.actorUserId,
      env
    ).catch(async (error: unknown) => {
      const code = error instanceof Error ? error.message.slice(0, 120) : "COMMAND_FAILED";
      await editInteractionResponse({
        applicationId: interaction.application_id,
        interactionToken: interaction.token,
        content: `Command failed: ${code}`
      }).catch(() => undefined);
    })
  );
  return deferredInteractionResponse();
}

async function handleInternalStatus(request: Request, env: Env): Promise<Response> {
  const expected = `Bearer ${env.INTERNAL_STATUS_SECRET}`;
  const supplied = request.headers.get("authorization") ?? "";
  if (supplied.length !== expected.length) return new Response("Unauthorized", { status: 401 });
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  if (mismatch !== 0) return new Response("Unauthorized", { status: 401 });
  return Response.json(await getSessionStatus(env));
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/healthz" && request.method === "GET") {
      return Response.json({ ok: true, service: "control-worker" });
    }
    if (url.pathname === "/discord/interactions" && request.method === "POST") {
      return handleInteraction(request, env, context);
    }
    if (url.pathname === "/agent/ws" && request.method === "GET") {
      if (request.headers.get("x-agent-id") !== env.DEPLOYMENT_ID) {
        return new Response("Unauthorized", { status: 401 });
      }
      return sessionStub(env).fetch(request);
    }
    if (url.pathname === "/internal/status" && request.method === "GET") {
      return handleInternalStatus(request, env);
    }
    return new Response("Not found", { status: 404 });
  },

  scheduled(_event: ScheduledController, env: Env, context: ExecutionContext): void {
    context.waitUntil(purgeExpiredAudit(env));
  }
} satisfies ExportedHandler<Env>;
