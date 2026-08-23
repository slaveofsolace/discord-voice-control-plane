import {
  commandLifetimeMs,
  controlActionSchema,
  parseActionPayload,
  relayIngressRequestSchema,
  type CommandAck,
  type ControlAction,
  type RelayIngressRequest,
  type UnsignedCommandEnvelope
} from "@discord-vc-control/contracts";
import { controlEnvironmentSchema } from "@discord-vc-control/config";
import {
  parseRelayContent,
  sanitizeRelayText,
  sha256Hex,
  signCommandEnvelope,
  verifyRelayIngress
} from "@discord-vc-control/security";

import { AgentSession } from "./agent-session.js";
import { recentAudit, purgeExpiredAudit, writeAudit } from "./audit.js";
import { authorizeInteraction } from "./authorization.js";
import {
  deferredInteractionResponse,
  editInteractionResponse,
  hasDiscordSignatureHeaders,
  InteractionBodyTooLargeError,
  interactionResponse,
  readInteractionBody,
  verifyDiscordRequest
} from "./discord.js";
import type { DiscordInteraction, Env, SessionStatus } from "./types.js";

export { AgentSession };

function sessionStub(env: Env): DurableObjectStub {
  return env.AGENT_SESSION.get(env.AGENT_SESSION.idFromName(env.DEPLOYMENT_ID));
}

export async function commandIdForInteraction(
  deploymentId: string,
  applicationId: string,
  interactionId: string
): Promise<string> {
  const digest = await sha256Hex(`${deploymentId}:${applicationId}:${interactionId}`);
  const variant = ((Number.parseInt(digest[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

async function claimCommandInteraction(
  env: Env,
  interactionId: string,
  commandId: string
): Promise<boolean> {
  const response = await sessionStub(env).fetch("https://session/interactions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ interaction_id: interactionId, command_id: commandId })
  });
  if (!response.ok) throw new Error(`INTERACTION_CLAIM_${response.status}`);
  const result = await response.json<{ duplicate: boolean }>();
  return !result.duplicate;
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

const relayBodyLimit = 16 * 1024;

function csvSet(value: string): ReadonlySet<string> {
  return new Set(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

function relayActorAuthorization(
  actorUserId: string,
  actorRoleIds: readonly string[],
  env: Env
): { elevated: boolean; operator: boolean } {
  const elevated =
    csvSet(env.CONTROL_ELEVATED_USER_IDS).has(actorUserId) ||
    actorRoleIds.some((roleId) => csvSet(env.CONTROL_ELEVATED_ROLE_IDS).has(roleId));
  const operator =
    elevated ||
    csvSet(env.CONTROL_OPERATOR_USER_IDS).has(actorUserId) ||
    actorRoleIds.some((roleId) => csvSet(env.CONTROL_OPERATOR_ROLE_IDS).has(roleId));
  return { elevated, operator };
}

async function readRelayBody(request: Request): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > relayBodyLimit)
    throw new Error("RELAY_BODY_TOO_LARGE");
  const reader = request.body?.getReader();
  if (reader === undefined) return "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let body = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > relayBodyLimit) {
      await reader.cancel();
      throw new Error("RELAY_BODY_TOO_LARGE");
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
  return body + decoder.decode();
}

function validateRelayContext(input: RelayIngressRequest, env: Env): void {
  if (input.deployment_id !== env.DEPLOYMENT_ID) throw new Error("WRONG_DEPLOYMENT");
  if (input.tenant_id !== env.TENANT_ID) throw new Error("WRONG_TENANT");
  if (input.application_id !== env.CONTROL_RELAY_APPLICATION_ID) {
    throw new Error("WRONG_RELAY_APPLICATION");
  }
  if (input.control_guild_id !== env.CONTROL_GUILD_ID) throw new Error("WRONG_CONTROL_GUILD");
  if (input.control_channel_id !== env.CONTROL_RELAY_CHANNEL_ID) {
    throw new Error("WRONG_CONTROL_RELAY_CHANNEL");
  }
  if (!relayActorAuthorization(input.actor_user_id, input.actor_role_ids, env).operator) {
    throw new Error("RELAY_ACTOR_UNAUTHORIZED");
  }
}

interface RelaySessionRecord {
  actor_user_id: string;
  request_id: string;
  result_code: string;
  status: string;
}

async function getRelaySessionRecord(
  env: Env,
  requestId: string
): Promise<RelaySessionRecord | null> {
  const response = await sessionStub(env).fetch(`https://session/relay-status/${requestId}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`RELAY_STATUS_${response.status}`);
  return response.json<RelaySessionRecord>();
}

function relayResponse(
  accepted: boolean,
  requestId: string | null,
  status: string | null,
  resultCode: string,
  duplicate = false,
  responseStatus = 200
): Response {
  return Response.json(
    {
      accepted,
      duplicate,
      request_id: requestId,
      status,
      result_code: resultCode
    },
    { status: responseStatus }
  );
}

async function writeRelayRequestMetadata(
  env: Env,
  input: Extract<RelayIngressRequest, { operation: "create" }>,
  requestId: string,
  contentHash: string,
  contentLength: number,
  contentKind: string,
  risk: string
): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO relay_requests
      (request_id, deployment_id, tenant_id, application_id, source_message_id,
       actor_user_id, control_guild_id, control_channel_id, content_hash, content_length,
       content_kind, risk, status, result_code, occurred_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED', 'PENDING_USER_APPROVAL', ?, ?, ?)
     ON CONFLICT(request_id) DO NOTHING`
  )
    .bind(
      requestId,
      env.DEPLOYMENT_ID,
      env.TENANT_ID,
      input.application_id,
      input.source_message_id,
      input.actor_user_id,
      input.control_guild_id,
      input.control_channel_id,
      contentHash,
      contentLength,
      contentKind,
      risk,
      now,
      now,
      now + 30 * 24 * 60 * 60_000
    )
    .run();
}

async function abortRelayClaim(env: Env, requestId: string): Promise<void> {
  await sessionStub(env).fetch("https://session/relay-claim-abort", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ request_id: requestId })
  });
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM relay_requests WHERE deployment_id = ? AND request_id = ? AND status = 'RECEIVED'"
    ).bind(env.DEPLOYMENT_ID, requestId),
    env.DB.prepare(
      "DELETE FROM audit_events WHERE deployment_id = ? AND command_id = ? AND result_code = 'RECEIVED'"
    ).bind(env.DEPLOYMENT_ID, requestId)
  ]);
}

async function acceptRelayNonce(env: Env, nonce: string): Promise<boolean> {
  const response = await sessionStub(env).fetch("https://session/relay-nonces", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nonce: `relay:${nonce}` })
  });
  return response.ok;
}

async function handleRelayCreate(
  input: Extract<RelayIngressRequest, { operation: "create" }>,
  nonce: string,
  env: Env
): Promise<Response> {
  const session = await getSessionStatus(env);
  if (
    !session.agentConnected ||
    session.heartbeatStale ||
    session.status?.agent_kind !== "authorized_local_rpc" ||
    session.status.local_rpc_connected !== true
  ) {
    return relayResponse(false, null, null, "LOCAL_AGENT_OFFLINE", false, 409);
  }
  let parsed: ReturnType<typeof parseRelayContent>;
  try {
    parsed = parseRelayContent(input.content);
  } catch {
    return relayResponse(false, null, null, "INVALID_RELAY_GRAMMAR", false, 400);
  }
  const authorization = relayActorAuthorization(input.actor_user_id, input.actor_role_ids, env);
  if (parsed.risk === "ELEVATED" && !authorization.elevated) {
    return relayResponse(false, null, null, "ELEVATED_OPERATOR_REQUIRED", false, 403);
  }
  const requestId = await commandIdForInteraction(
    env.DEPLOYMENT_ID,
    input.application_id,
    input.source_message_id
  );
  const contentHash = await sha256Hex(parsed.text);
  const claim = await sessionStub(env).fetch("https://session/relay-claims", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      request_id: requestId,
      source_key: `${env.DEPLOYMENT_ID}:${input.application_id}:${input.source_message_id}`,
      content_hash: contentHash,
      actor_user_id: input.actor_user_id,
      nonce: `relay:${nonce}`
    })
  });
  if (!claim.ok) {
    const result: { error?: string } = await claim.json<{ error?: string }>().catch(() => ({}));
    return relayResponse(false, requestId, null, result.error ?? "RELAY_CLAIM_FAILED", false, 409);
  }
  const claimed = await claim.json<{ duplicate: boolean }>();
  if (claimed.duplicate) {
    const existing = await getRelaySessionRecord(env, requestId);
    return relayResponse(
      true,
      requestId,
      existing?.status ?? "RECEIVED",
      existing?.result_code ?? "PENDING_USER_APPROVAL",
      true
    );
  }
  const now = Date.now();
  const unsigned: UnsignedCommandEnvelope = {
    version: 1,
    command_id: requestId,
    issued_at: now,
    expires_at: now + commandLifetimeMs,
    nonce: `relay-command:${nonce}`,
    actor_user_id: input.actor_user_id,
    control_guild_id: input.control_guild_id,
    control_channel_id: input.control_channel_id,
    deployment_id: env.DEPLOYMENT_ID,
    tenant_id: env.TENANT_ID,
    action: "relay",
    payload: {
      text: parsed.text,
      request_id: requestId,
      source_application_id: input.application_id,
      source_message_id: input.source_message_id,
      actor_role_ids: input.actor_role_ids,
      content_kind: parsed.contentKind,
      risk: parsed.risk,
      parsed_command: parsed.parsedCommand
    },
    kid: env.AGENT_KEY_ID
  };
  const envelope = await signCommandEnvelope(unsigned, env.AGENT_AUTH_SECRET);
  try {
    await writeAudit(env, envelope, {
      contentHash,
      contentLength: parsed.text.length,
      resultCode: "RECEIVED"
    });
    await writeRelayRequestMetadata(
      env,
      input,
      requestId,
      contentHash,
      parsed.text.length,
      parsed.contentKind,
      parsed.risk
    );
    const queued = await sessionStub(env).fetch("https://session/commands", {
      method: "POST",
      headers: { "content-type": "application/json", "x-require-local-rpc": "true" },
      body: JSON.stringify(envelope)
    });
    if (!queued.ok) throw new Error("LOCAL_AGENT_OFFLINE");
  } catch {
    await abortRelayClaim(env, requestId).catch(() => undefined);
    return relayResponse(false, requestId, null, "LOCAL_AGENT_OFFLINE", false, 409);
  }
  const receipt = await waitForReceipt(env, requestId);
  if (receipt === null) {
    return relayResponse(true, requestId, "RECEIVED", "PENDING_USER_APPROVAL");
  }
  return relayResponse(
    receipt.accepted,
    requestId,
    receipt.accepted ? "PENDING_USER_APPROVAL" : null,
    receipt.result_code,
    receipt.duplicate,
    receipt.accepted ? 200 : 409
  );
}

async function handleRelayStatusOrCancel(
  input: Extract<RelayIngressRequest, { operation: "status" | "cancel" }>,
  nonce: string,
  env: Env
): Promise<Response> {
  if (!(await acceptRelayNonce(env, nonce))) {
    return relayResponse(false, input.request_id, null, "RELAY_NONCE_REPLAY", false, 409);
  }
  const record = await getRelaySessionRecord(env, input.request_id);
  if (record === null)
    return relayResponse(false, input.request_id, null, "REQUEST_NOT_FOUND", false, 404);
  const authorization = relayActorAuthorization(input.actor_user_id, input.actor_role_ids, env);
  if (record.actor_user_id !== input.actor_user_id && !authorization.elevated) {
    return relayResponse(false, input.request_id, null, "RELAY_CONTROL_UNAUTHORIZED", false, 403);
  }
  if (input.operation === "status") {
    return relayResponse(true, input.request_id, record.status, record.result_code);
  }
  if (["OWNER_CONFIRMED_SENT", "OWNER_REJECTED", "EXPIRED", "CANCELLED"].includes(record.status)) {
    return relayResponse(true, input.request_id, record.status, record.result_code, true);
  }
  const now = Date.now();
  const commandId = await commandIdForInteraction(
    env.DEPLOYMENT_ID,
    input.application_id,
    `${input.source_message_id}${input.request_id}`
  );
  const envelope = await signCommandEnvelope(
    {
      version: 1,
      command_id: commandId,
      issued_at: now,
      expires_at: now + commandLifetimeMs,
      nonce: `relay-cancel:${nonce}`,
      actor_user_id: input.actor_user_id,
      control_guild_id: input.control_guild_id,
      control_channel_id: input.control_channel_id,
      deployment_id: env.DEPLOYMENT_ID,
      tenant_id: env.TENANT_ID,
      action: "relay_cancel",
      payload: { request_id: input.request_id },
      kid: env.AGENT_KEY_ID
    },
    env.AGENT_AUTH_SECRET
  );
  const queued = await sessionStub(env).fetch("https://session/commands", {
    method: "POST",
    headers: { "content-type": "application/json", "x-require-local-rpc": "true" },
    body: JSON.stringify(envelope)
  });
  if (!queued.ok)
    return relayResponse(false, input.request_id, record.status, "LOCAL_AGENT_OFFLINE", false, 503);
  const receipt = await waitForReceipt(env, commandId);
  return relayResponse(
    receipt?.accepted === true,
    input.request_id,
    receipt?.accepted === true ? "CANCELLED" : record.status,
    receipt?.result_code ?? "LOCAL_AGENT_OFFLINE",
    receipt?.duplicate ?? false,
    receipt?.accepted === true ? 200 : 409
  );
}

async function handleRelayIngress(request: Request, env: Env): Promise<Response> {
  if (env.CONTROL_RELAY_ENABLED !== "true") return new Response("Not found", { status: 404 });
  const timestamp = Number(request.headers.get("x-relay-timestamp") ?? "");
  const nonce = request.headers.get("x-relay-nonce") ?? "";
  const signature = request.headers.get("x-relay-signature") ?? "";
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(Date.now() - timestamp) > 30_000 ||
    nonce.length < 16 ||
    nonce.length > 128 ||
    signature.length !== 43
  ) {
    return relayResponse(false, null, null, "RELAY_INGRESS_UNAUTHORIZED", false, 401);
  }
  let rawBody: string;
  try {
    rawBody = await readRelayBody(request);
  } catch {
    return relayResponse(false, null, null, "RELAY_BODY_TOO_LARGE", false, 413);
  }
  if (
    !(await verifyRelayIngress(
      { nonce, rawBody, signature, timestamp },
      env.RELAY_INGRESS_HMAC_SECRET
    ))
  ) {
    return relayResponse(false, null, null, "RELAY_INGRESS_UNAUTHORIZED", false, 401);
  }
  let input: RelayIngressRequest;
  try {
    input = relayIngressRequestSchema.parse(JSON.parse(rawBody));
    validateRelayContext(input, env);
  } catch (error) {
    const code =
      error instanceof Error && /^[A-Z\d_]{1,64}$/u.test(error.message)
        ? error.message
        : "INVALID_RELAY_INGRESS";
    return relayResponse(false, null, null, code, false, 400);
  }
  return input.operation === "create"
    ? handleRelayCreate(input, nonce, env)
    : handleRelayStatusOrCancel(input, nonce, env);
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
  commandId: string,
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
    command_id: commandId,
    issued_at: now,
    expires_at: now + commandLifetimeMs,
    nonce: `discord:${interaction.id}`,
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
    const fallback = await sessionStub(env).fetch("https://session/audit-outbox", {
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
    if (!fallback.ok) throw new Error(`AUDIT_DURABILITY_${fallback.status}`);
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
  if (!hasDiscordSignatureHeaders(request)) {
    return new Response("Invalid request signature", { status: 401 });
  }
  let rawBody: string;
  try {
    rawBody = await readInteractionBody(request);
  } catch (error) {
    if (error instanceof InteractionBodyTooLargeError) {
      return new Response("Request body too large", { status: 413 });
    }
    return new Response("Invalid request body", { status: 400 });
  }
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
  const commandId = await commandIdForInteraction(
    env.DEPLOYMENT_ID,
    interaction.application_id,
    interaction.id
  );
  if (!(await claimCommandInteraction(env, interaction.id, commandId))) {
    return deferredInteractionResponse();
  }
  context.waitUntil(
    dispatchCommand(
      interaction,
      parsed.action,
      parsed.values,
      authorization.actorUserId,
      commandId,
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
    if (!controlEnvironmentSchema.safeParse(env).success) {
      return new Response("Service unavailable", { status: 503 });
    }
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
    if (url.pathname === "/internal/relay-ingress" && request.method === "POST") {
      return handleRelayIngress(request, env);
    }
    return new Response("Not found", { status: 404 });
  },

  scheduled(_event: ScheduledController, env: Env, context: ExecutionContext): void {
    controlEnvironmentSchema.parse(env);
    context.waitUntil(purgeExpiredAudit(env));
  }
} satisfies ExportedHandler<Env>;
