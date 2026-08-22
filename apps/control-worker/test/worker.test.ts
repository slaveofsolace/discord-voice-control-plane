import { env } from "cloudflare:workers";
import {
  abortAllDurableObjects,
  applyD1Migrations,
  runDurableObjectAlarm,
  runInDurableObject,
  SELF,
  type D1Migration
} from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import {
  agentHandshakePayload,
  signAgentHandshake,
  signCommandEnvelope,
  signRelayIngress
} from "@discord-vc-control/security";

import { authorizeInteraction } from "../src/authorization.js";
import { purgeExpiredAudit, recentAudit } from "../src/audit.js";
import type { DiscordInteraction, Env } from "../src/types.js";

const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] };

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

async function openAgentSocket(stub: DurableObjectStub): Promise<WebSocket> {
  const timestamp = Date.now();
  const nonce = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const signature = await signAgentHandshake(
    agentHandshakePayload({
      agentId: env.DEPLOYMENT_ID,
      method: "GET",
      nonce,
      path: "/agent/ws",
      timestamp
    }),
    env.AGENT_AUTH_SECRET
  );
  const response = await stub.fetch("https://session/agent/ws", {
    headers: {
      Upgrade: "websocket",
      "x-agent-id": env.DEPLOYMENT_ID,
      "x-agent-key-id": env.AGENT_KEY_ID,
      "x-agent-nonce": nonce,
      "x-agent-signature": signature,
      "x-agent-timestamp": String(timestamp)
    }
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null) throw new Error("TEST_AGENT_SOCKET_MISSING");
  socket.accept();
  return socket;
}

const relaySecret = "test-relay-secret-with-at-least-32-bytes";

function relayBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    operation: "create",
    deployment_id: env.DEPLOYMENT_ID,
    tenant_id: env.TENANT_ID,
    application_id: "100000000000000001",
    source_message_id: "100000000000000090",
    actor_user_id: "100000000000000004",
    actor_role_ids: [],
    control_guild_id: env.CONTROL_GUILD_ID,
    control_channel_id: "100000000000000003",
    content: "ordinary relay content",
    ...overrides
  };
}

async function relayFetch(
  body: Record<string, unknown>,
  input: { nonce?: string; rawBody?: string; signature?: string; timestamp?: number } = {}
): Promise<Response> {
  const rawBody = input.rawBody ?? JSON.stringify(body);
  const timestamp = input.timestamp ?? Date.now();
  const nonce = input.nonce ?? `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const signature =
    input.signature ?? (await signRelayIngress({ nonce, rawBody, timestamp }, relaySecret));
  return SELF.fetch("https://example.test/internal/relay-ingress", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-relay-nonce": nonce,
      "x-relay-signature": signature,
      "x-relay-timestamp": String(timestamp)
    },
    body: rawBody
  });
}

async function makeAuthorizedLocalAgent(stub: DurableObjectStub): Promise<WebSocket> {
  const socket = await openAgentSocket(stub);
  await runInDurableObject(stub, async (instance, state) => {
    const serverSocket = state.getWebSockets("agent")[0];
    if (serverSocket === undefined) throw new Error("TEST_SERVER_SOCKET_MISSING");
    await instance.webSocketMessage(
      serverSocket,
      JSON.stringify({
        type: "status",
        deployment_id: env.DEPLOYMENT_ID,
        agent_kind: "authorized_local_rpc",
        local_rpc_connected: true,
        desired_connected: true,
        observed_state: "CONNECTED",
        gateway_connected: false,
        voice_connected: true,
        udp_established: false,
        dave_established: false,
        target_guild_id: "100000000000000020",
        target_channel_id: "100000000000000021",
        circuit_open: false,
        retry_count: 0,
        last_error_code: null,
        last_health_at: Date.now()
      })
    );
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as Record<string, unknown>;
    if (
      message.version !== 1 ||
      (message.action !== "relay" && message.action !== "relay_cancel")
    ) {
      return;
    }
    const commandId = String(message.command_id);
    const payload = message.payload as { request_id?: string };
    const requestId = message.action === "relay" ? commandId : String(payload.request_id);
    socket.send(
      JSON.stringify({
        type: "command_start",
        command_id: commandId,
        deployment_id: env.DEPLOYMENT_ID,
        occurred_at: Date.now()
      })
    );
    setTimeout(() => {
      socket.send(
        JSON.stringify({
          type: "relay_status",
          deployment_id: env.DEPLOYMENT_ID,
          request_id: requestId,
          command_id: requestId,
          actor_user_id: "100000000000000004",
          source_application_id: "100000000000000001",
          source_message_id: "100000000000000090",
          status: message.action === "relay" ? "PENDING_USER_APPROVAL" : "CANCELLED",
          result_code: message.action === "relay" ? "PENDING_USER_APPROVAL" : "REQUEST_CANCELLED",
          occurred_at: Date.now()
        })
      );
      socket.send(
        JSON.stringify({
          type: "ack",
          command_id: commandId,
          accepted: true,
          duplicate: false,
          result_code: message.action === "relay" ? "PENDING_USER_APPROVAL" : "REQUEST_CANCELLED",
          summary:
            message.action === "relay"
              ? "Waiting for local owner approval."
              : "Cancelled before manual send.",
          observed_state: "CONNECTED",
          occurred_at: Date.now()
        })
      );
    }, 0);
  });
  return socket;
}

describe("control worker", () => {
  it("serves only a minimal public health response", async () => {
    const response = await SELF.fetch("https://example.test/healthz");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: "control-worker" });
  });

  it("rejects missing Discord signatures before parsing", async () => {
    const response = await SELF.fetch("https://example.test/discord/interactions", {
      method: "POST",
      body: "not-json"
    });
    expect(response.status).toBe(401);
  });

  it("requires internal authentication", async () => {
    const response = await SELF.fetch("https://example.test/internal/status");
    expect(response.status).toBe(401);
  });

  it("rejects relay ingress tampering, stale timestamps, and oversized bodies", async () => {
    const body = relayBody();
    const validRaw = JSON.stringify(body);
    const nonce = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    const timestamp = Date.now();
    const signature = await signRelayIngress({ nonce, rawBody: validRaw, timestamp }, relaySecret);
    const tampered = await relayFetch(body, {
      nonce,
      timestamp,
      signature,
      rawBody: JSON.stringify({ ...body, content: "tampered" })
    });
    expect(tampered.status).toBe(401);
    const stale = await relayFetch(body, { timestamp: Date.now() - 31_000 });
    expect(stale.status).toBe(401);
    const oversized = await relayFetch(body, { rawBody: "x".repeat(16 * 1024 + 1) });
    expect(oversized.status).toBe(413);
  });

  it("rejects an offline local agent without retaining relay metadata or content", async () => {
    await abortAllDurableObjects();
    const response = await relayFetch(relayBody({ source_message_id: "100000000000000091" }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ result_code: "LOCAL_AGENT_OFFLINE" });
    const stored = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM relay_requests WHERE source_message_id = ?"
    )
      .bind("100000000000000091")
      .first<{ count: number }>();
    expect(stored?.count).toBe(0);
  });

  it("enforces relay actor, elevation, guild, channel, application, and grammar", async () => {
    await abortAllDurableObjects();
    const stub = env.AGENT_SESSION.get(env.AGENT_SESSION.idFromName(env.DEPLOYMENT_ID));
    const socket = await makeAuthorizedLocalAgent(stub);
    for (const [override, code] of [
      [{ actor_user_id: "100000000000000099" }, "RELAY_ACTOR_UNAUTHORIZED"],
      [{ control_guild_id: "100000000000000099" }, "WRONG_CONTROL_GUILD"],
      [{ control_channel_id: "100000000000000099" }, "WRONG_CONTROL_RELAY_CHANNEL"],
      [{ application_id: "100000000000000099" }, "WRONG_RELAY_APPLICATION"],
      [{ content: "/unknown" }, "INVALID_RELAY_GRAMMAR"],
      [
        { actor_user_id: "100000000000000005", content: "!voice ban 100000000000000099" },
        "ELEVATED_OPERATOR_REQUIRED"
      ]
    ] as const) {
      const response = await relayFetch(
        relayBody({
          ...override,
          source_message_id: String(
            BigInt("100000000000000100") + BigInt((Math.random() * 1000) | 0)
          )
        })
      );
      expect((await response.json<{ result_code: string }>()).result_code).toBe(code);
    }
    socket.close();
  });

  it("queues one metadata-only request and makes gateway reconnect delivery idempotent", async () => {
    await abortAllDurableObjects();
    const stub = env.AGENT_SESSION.get(env.AGENT_SESSION.idFromName(env.DEPLOYMENT_ID));
    const socket = await makeAuthorizedLocalAgent(stub);
    const body = relayBody({ source_message_id: "100000000000000190" });
    const first = await relayFetch(body);
    expect(first.status).toBe(200);
    const firstResult = await first.json<{
      accepted: boolean;
      duplicate: boolean;
      request_id: string;
      result_code: string;
    }>();
    expect(firstResult).toMatchObject({
      accepted: true,
      duplicate: false,
      result_code: "PENDING_USER_APPROVAL"
    });
    const duplicate = await relayFetch(body);
    await expect(duplicate.json()).resolves.toMatchObject({
      accepted: true,
      duplicate: true,
      request_id: firstResult.request_id
    });
    const stored = await env.DB.prepare(
      `SELECT content_hash, content_length, status, result_code
         FROM relay_requests WHERE request_id = ?`
    )
      .bind(firstResult.request_id)
      .first<Record<string, unknown>>();
    expect(stored).toMatchObject({
      content_length: "ordinary relay content".length,
      status: "PENDING_USER_APPROVAL",
      result_code: "PENDING_USER_APPROVAL"
    });
    expect(JSON.stringify(stored)).not.toContain("ordinary relay content");
    const replayNonce = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    const replayBody = relayBody({ source_message_id: "100000000000000191" });
    const rawReplayBody = JSON.stringify(replayBody);
    const replayTimestamp = Date.now();
    const replaySignature = await signRelayIngress(
      { nonce: replayNonce, rawBody: rawReplayBody, timestamp: replayTimestamp },
      relaySecret
    );
    expect(
      (
        await relayFetch(replayBody, {
          nonce: replayNonce,
          rawBody: rawReplayBody,
          signature: replaySignature,
          timestamp: replayTimestamp
        })
      ).status
    ).toBe(200);
    const replay = await relayFetch(replayBody, {
      nonce: replayNonce,
      rawBody: rawReplayBody,
      signature: replaySignature,
      timestamp: replayTimestamp
    });
    await expect(replay.json()).resolves.toMatchObject({ result_code: "RELAY_NONCE_REPLAY" });
    socket.close();
  });

  it("keeps status content-free and permits cancellation only to the originator or elevation", async () => {
    await abortAllDurableObjects();
    const stub = env.AGENT_SESSION.get(env.AGENT_SESSION.idFromName(env.DEPLOYMENT_ID));
    const socket = await makeAuthorizedLocalAgent(stub);
    const created = await relayFetch(relayBody({ source_message_id: "100000000000000192" }));
    const createdResult = await created.json<{ request_id: string }>();
    const denied = await relayFetch(
      relayBody({
        operation: "cancel",
        request_id: createdResult.request_id,
        source_message_id: "100000000000000193",
        actor_user_id: "100000000000000005",
        content: undefined
      })
    );
    expect(denied.status).toBe(403);
    const status = await relayFetch(
      relayBody({
        operation: "status",
        request_id: createdResult.request_id,
        source_message_id: "100000000000000194",
        content: undefined
      })
    );
    const statusText = await status.text();
    expect(statusText).toContain("PENDING_USER_APPROVAL");
    expect(statusText).not.toContain("ordinary relay content");
    const cancelled = await relayFetch(
      relayBody({
        operation: "cancel",
        request_id: createdResult.request_id,
        source_message_id: "100000000000000195",
        content: undefined
      })
    );
    await expect(cancelled.json()).resolves.toMatchObject({
      accepted: true,
      status: "CANCELLED",
      result_code: "REQUEST_CANCELLED"
    });
    socket.close();
  });

  it("uses server receipt time for heartbeat freshness", async () => {
    const stub = env.AGENT_SESSION.get(
      env.AGENT_SESSION.idFromName(`heartbeat-${crypto.randomUUID()}`)
    );
    const clientSocket = await openAgentSocket(stub);
    const before = Date.now();
    await runInDurableObject(stub, async (instance, state) => {
      const serverSocket = state.getWebSockets("agent")[0];
      if (serverSocket === undefined) throw new Error("TEST_SERVER_SOCKET_MISSING");
      await instance.webSocketMessage(
        serverSocket,
        JSON.stringify({
          type: "heartbeat",
          deployment_id: env.DEPLOYMENT_ID,
          sent_at: Date.now() + 24 * 60 * 60_000,
          gateway_sequence: 1
        })
      );
      const row = state.storage.sql
        .exec<{ last_heartbeat: number | null }>(
          "SELECT last_heartbeat FROM session_state WHERE id = 1"
        )
        .one();
      expect(row.last_heartbeat).toBeGreaterThanOrEqual(before);
      expect(row.last_heartbeat).toBeLessThanOrEqual(Date.now());
    });
    clientSocket.close();
  });

  it("rejects a heartbeat for another deployment before updating liveness", async () => {
    const stub = env.AGENT_SESSION.get(
      env.AGENT_SESSION.idFromName(`wrong-heartbeat-${crypto.randomUUID()}`)
    );
    const clientSocket = await openAgentSocket(stub);
    await runInDurableObject(stub, async (instance, state) => {
      const serverSocket = state.getWebSockets("agent")[0];
      if (serverSocket === undefined) throw new Error("TEST_SERVER_SOCKET_MISSING");
      const before = state.storage.sql
        .exec<{ last_heartbeat: number | null }>(
          "SELECT last_heartbeat FROM session_state WHERE id = 1"
        )
        .one().last_heartbeat;
      await instance.webSocketMessage(
        serverSocket,
        JSON.stringify({
          type: "heartbeat",
          deployment_id: "another-deployment",
          sent_at: Date.now(),
          gateway_sequence: 1
        })
      );
      const row = state.storage.sql
        .exec<{ last_error: string | null; last_heartbeat: number | null }>(
          "SELECT last_error, last_heartbeat FROM session_state WHERE id = 1"
        )
        .one();
      expect(row).toMatchObject({ last_error: "WRONG_DEPLOYMENT", last_heartbeat: before });
    });
    clientSocket.close();
  });

  it("enforces application, guild, channel, actor, and elevation allowlists", () => {
    const interaction: DiscordInteraction = {
      id: "100000000000000010",
      application_id: env.CONTROL_DISCORD_APPLICATION_ID,
      type: 2,
      token: "transient",
      guild_id: env.CONTROL_GUILD_ID,
      channel_id: "100000000000000003",
      member: { user: { id: "100000000000000004" }, roles: [] }
    };
    expect(authorizeInteraction(interaction, "join", env as unknown as Env)).toMatchObject({
      allowed: true
    });
    expect(authorizeInteraction(interaction, "reconnect", env as unknown as Env)).toMatchObject({
      allowed: true,
      elevated: true
    });
    expect(
      authorizeInteraction(
        { ...interaction, guild_id: "100000000000000099" },
        "join",
        env as unknown as Env
      )
    ).toEqual({ allowed: false, code: "WRONG_CONTROL_GUILD" });
  });

  it("queues a signed command once and treats the same command as idempotent", async () => {
    const now = Date.now();
    const envelope = await signCommandEnvelope(
      {
        version: 1,
        command_id: crypto.randomUUID(),
        issued_at: now,
        expires_at: now + 30_000,
        nonce: crypto.randomUUID(),
        actor_user_id: "100000000000000004",
        control_guild_id: env.CONTROL_GUILD_ID,
        control_channel_id: "100000000000000003",
        deployment_id: env.DEPLOYMENT_ID,
        tenant_id: env.TENANT_ID,
        action: "status",
        payload: {},
        kid: env.AGENT_KEY_ID
      },
      env.AGENT_AUTH_SECRET
    );
    const stub = env.AGENT_SESSION.get(env.AGENT_SESSION.idFromName(env.DEPLOYMENT_ID));
    const request = () =>
      stub.fetch("https://session/commands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelope)
      });
    const first = await request();
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ queued: true, duplicate: false });
    const second = await request();
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({ queued: true, duplicate: true });
  });

  it("claims one Discord interaction ID durably", async () => {
    const objectId = env.AGENT_SESSION.idFromName(`interaction-${crypto.randomUUID()}`);
    let stub = env.AGENT_SESSION.get(objectId);
    const body = JSON.stringify({
      interaction_id: "100000000000000010",
      command_id: "00000000-0000-5000-8000-000000000001"
    });
    const claim = () =>
      stub.fetch("https://session/interactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body
      });
    await expect((await claim()).json()).resolves.toMatchObject({ duplicate: false });
    await expect((await claim()).json()).resolves.toMatchObject({ duplicate: true });
    await abortAllDurableObjects();
    stub = env.AGENT_SESSION.get(objectId);
    await expect((await claim()).json()).resolves.toMatchObject({ duplicate: true });
  });

  it("moves a command to a durable executing ledger before side effects", async () => {
    const now = Date.now();
    const envelope = await signCommandEnvelope(
      {
        version: 1,
        command_id: crypto.randomUUID(),
        issued_at: now,
        expires_at: now + 30_000,
        nonce: crypto.randomUUID(),
        actor_user_id: "100000000000000004",
        control_guild_id: env.CONTROL_GUILD_ID,
        control_channel_id: "100000000000000003",
        deployment_id: env.DEPLOYMENT_ID,
        tenant_id: env.TENANT_ID,
        action: "reconnect",
        payload: {},
        kid: env.AGENT_KEY_ID
      },
      env.AGENT_AUTH_SECRET
    );
    const objectId = env.AGENT_SESSION.idFromName(`executing-${crypto.randomUUID()}`);
    let stub = env.AGENT_SESSION.get(objectId);
    expect(
      (
        await stub.fetch("https://session/commands", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(envelope)
        })
      ).status
    ).toBe(200);
    const clientSocket = await openAgentSocket(stub);
    await runInDurableObject(stub, async (instance, state) => {
      const serverSocket = state.getWebSockets("agent")[0];
      if (serverSocket === undefined) throw new Error("TEST_SERVER_SOCKET_MISSING");
      await instance.webSocketMessage(
        serverSocket,
        JSON.stringify({
          type: "command_start",
          command_id: envelope.command_id,
          deployment_id: env.DEPLOYMENT_ID,
          occurred_at: Date.now()
        })
      );
      const counts = state.storage.sql
        .exec<{ executing: number; pending: number }>(
          `SELECT
             (SELECT COUNT(*) FROM pending_commands) AS pending,
             (SELECT COUNT(*) FROM executing_commands) AS executing`
        )
        .one();
      expect(counts).toEqual({ pending: 0, executing: 1 });
    });
    clientSocket.close();
    await abortAllDurableObjects();
    stub = env.AGENT_SESSION.get(objectId);
    const duplicate = await stub.fetch("https://session/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(envelope)
    });
    await expect(duplicate.json()).resolves.toMatchObject({
      duplicate: true,
      executing: true,
      queued: false
    });
  });

  it("rejects nonce reuse across different signed command IDs", async () => {
    const now = Date.now();
    const nonce = crypto.randomUUID();
    const base = {
      version: 1 as const,
      issued_at: now,
      expires_at: now + 30_000,
      nonce,
      actor_user_id: "100000000000000004",
      control_guild_id: env.CONTROL_GUILD_ID,
      control_channel_id: "100000000000000003",
      deployment_id: env.DEPLOYMENT_ID,
      tenant_id: env.TENANT_ID,
      action: "status" as const,
      payload: {},
      kid: env.AGENT_KEY_ID
    };
    const stub = env.AGENT_SESSION.get(env.AGENT_SESSION.idFromName(env.DEPLOYMENT_ID));
    const send = async (commandId: string) =>
      stub.fetch("https://session/commands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          await signCommandEnvelope({ ...base, command_id: commandId }, env.AGENT_AUTH_SECRET)
        )
      });
    expect((await send(crypto.randomUUID())).status).toBe(200);
    expect((await send(crypto.randomUUID())).status).toBe(409);
  });

  it("rejects a signed command for another tenant", async () => {
    const now = Date.now();
    const envelope = await signCommandEnvelope(
      {
        version: 1,
        command_id: crypto.randomUUID(),
        issued_at: now,
        expires_at: now + 30_000,
        nonce: crypto.randomUUID(),
        actor_user_id: "100000000000000004",
        control_guild_id: env.CONTROL_GUILD_ID,
        control_channel_id: "100000000000000003",
        deployment_id: env.DEPLOYMENT_ID,
        tenant_id: "another-tenant",
        action: "status",
        payload: {},
        kid: env.AGENT_KEY_ID
      },
      env.AGENT_AUTH_SECRET
    );
    const stub = env.AGENT_SESSION.get(
      env.AGENT_SESSION.idFromName(`wrong-tenant-${crypto.randomUUID()}`)
    );
    const response = await stub.fetch("https://session/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(envelope)
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "WRONG_TENANT" });
  });

  it("preserves a pending idempotency record across a Durable Object runtime restart", async () => {
    const now = Date.now();
    const envelope = await signCommandEnvelope(
      {
        version: 1,
        command_id: crypto.randomUUID(),
        issued_at: now,
        expires_at: now + 30_000,
        nonce: crypto.randomUUID(),
        actor_user_id: "100000000000000004",
        control_guild_id: env.CONTROL_GUILD_ID,
        control_channel_id: "100000000000000003",
        deployment_id: env.DEPLOYMENT_ID,
        tenant_id: env.TENANT_ID,
        action: "status",
        payload: {},
        kid: env.AGENT_KEY_ID
      },
      env.AGENT_AUTH_SECRET
    );
    const objectId = env.AGENT_SESSION.idFromName(`restart-${crypto.randomUUID()}`);
    let stub = env.AGENT_SESSION.get(objectId);
    const send = () =>
      stub.fetch("https://session/commands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelope)
      });
    expect((await send()).status).toBe(200);
    await abortAllDurableObjects();
    stub = env.AGENT_SESSION.get(objectId);
    const duplicate = await send();
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({ queued: true, duplicate: true });
  });

  it("purges an expired pending command through the Durable Object alarm", async () => {
    const now = Date.now();
    const envelope = await signCommandEnvelope(
      {
        version: 1,
        command_id: crypto.randomUUID(),
        issued_at: now,
        expires_at: now + 30_000,
        nonce: crypto.randomUUID(),
        actor_user_id: "100000000000000004",
        control_guild_id: env.CONTROL_GUILD_ID,
        control_channel_id: "100000000000000003",
        deployment_id: env.DEPLOYMENT_ID,
        tenant_id: env.TENANT_ID,
        action: "relay",
        payload: { text: "temporary relay payload" },
        kid: env.AGENT_KEY_ID
      },
      env.AGENT_AUTH_SECRET
    );
    const stub = env.AGENT_SESSION.get(
      env.AGENT_SESSION.idFromName(`alarm-${crypto.randomUUID()}`)
    );
    expect(
      (
        await stub.fetch("https://session/commands", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(envelope)
        })
      ).status
    ).toBe(200);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE pending_commands SET expires_at = 0 WHERE command_id = ?",
        envelope.command_id
      );
    });
    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    const status = await stub.fetch("https://session/status");
    await expect(status.json()).resolves.toMatchObject({ pendingCommands: 0 });
  });

  it("replays ordered agent state events from the Durable Object outbox", async () => {
    const guildId = "100000000000000077";
    const stub = env.AGENT_SESSION.get(
      env.AGENT_SESSION.idFromName(`state-outbox-${crypto.randomUUID()}`)
    );
    const event = {
      type: "guild_config_event",
      config: {
        deployment_id: env.DEPLOYMENT_ID,
        guild_id: guildId,
        feature_profile: "presence_only",
        managed_rooms_enabled: false,
        prefix_commands_enabled: false,
        category_id: null,
        lobby_channel_id: null,
        command_channel_id: null
      }
    };
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        "INSERT INTO state_outbox_v2 (state_key, event_json, created_at) VALUES (?, ?, ?)",
        `guild:${guildId}`,
        JSON.stringify(event),
        Date.now()
      );
      await state.storage.setAlarm(Date.now() + 1_000);
    });
    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    const stored = await env.DB.prepare(
      `SELECT feature_profile, managed_rooms_enabled
         FROM guild_configs
        WHERE deployment_id = ? AND guild_id = ?`
    )
      .bind(env.DEPLOYMENT_ID, guildId)
      .first<{ feature_profile: string; managed_rooms_enabled: number }>();
    expect(stored).toEqual({ feature_profile: "presence_only", managed_rooms_enabled: 0 });
    await runInDurableObject(stub, (_instance, state) => {
      const row = state.storage.sql
        .exec<{ count: number }>("SELECT COUNT(*) AS count FROM state_outbox_v2")
        .one();
      expect(row.count).toBe(0);
    });
  });

  it("fails closed instead of evicting a full state outbox", async () => {
    const stub = env.AGENT_SESSION.get(
      env.AGENT_SESSION.idFromName(`state-full-${crypto.randomUUID()}`)
    );
    const clientSocket = await openAgentSocket(stub);
    await runInDurableObject(stub, async (instance, state) => {
      for (let index = 0; index < 1_000; index += 1) {
        state.storage.sql.exec(
          "INSERT INTO state_outbox_v2 (state_key, event_json, created_at) VALUES (?, '{}', ?)",
          `seed:${index}`,
          index
        );
      }
      const serverSocket = state.getWebSockets("agent")[0];
      if (serverSocket === undefined) throw new Error("TEST_SERVER_SOCKET_MISSING");
      await instance.webSocketMessage(
        serverSocket,
        JSON.stringify({
          type: "guild_config_event",
          config: {
            deployment_id: env.DEPLOYMENT_ID,
            guild_id: "100000000000000077",
            feature_profile: "presence_only",
            managed_rooms_enabled: false,
            prefix_commands_enabled: false,
            category_id: null,
            lobby_channel_id: null,
            command_channel_id: null
          }
        })
      );
      const count = state.storage.sql
        .exec<{ count: number }>("SELECT COUNT(*) AS count FROM state_outbox_v2")
        .one().count;
      const error = state.storage.sql
        .exec<{ last_error: string | null }>("SELECT last_error FROM session_state WHERE id = 1")
        .one().last_error;
      expect(count).toBe(1_000);
      expect(error).toBe("STATE_OUTBOX_FULL");
    });
    clientSocket.close();
  });

  it("fails closed when the audit fallback reaches capacity", async () => {
    const stub = env.AGENT_SESSION.get(
      env.AGENT_SESSION.idFromName(`audit-full-${crypto.randomUUID()}`)
    );
    await runInDurableObject(stub, (_instance, state) => {
      for (let index = 0; index < 100; index += 1) {
        state.storage.sql.exec(
          "INSERT INTO audit_outbox (event_json, created_at) VALUES ('{}', ?)",
          index
        );
      }
    });
    const response = await stub.fetch("https://session/audit-outbox", {
      method: "POST",
      body: "{}"
    });
    expect(response.status).toBe(507);
    await runInDurableObject(stub, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM audit_outbox")
          .one().count
      ).toBe(100);
    });
  });

  it("closes an authenticated agent after heartbeat staleness", async () => {
    const stub = env.AGENT_SESSION.get(
      env.AGENT_SESSION.idFromName(`stale-agent-${crypto.randomUUID()}`)
    );
    const clientSocket = await openAgentSocket(stub);
    const closed = new Promise<number>((resolve) => {
      clientSocket.addEventListener("close", (event) => resolve(event.code), { once: true });
    });
    await runInDurableObject(stub, async (instance, state) => {
      state.storage.sql.exec("UPDATE session_state SET last_heartbeat = 0 WHERE id = 1");
      await instance.alarm();
    });
    await expect(closed).resolves.toBe(1008);
  });

  it("enforces audit retention and the hard result cap against migrated D1", async () => {
    const now = Date.now();
    const deployment = env.DEPLOYMENT_ID;
    await env.DB.prepare(
      `INSERT OR IGNORE INTO deployments (deployment_id, tenant_id, created_at, updated_at)
       VALUES (?, ?, ?, ?)`
    )
      .bind(deployment, env.TENANT_ID, now, now)
      .run();
    const statements = Array.from({ length: 52 }, (_, index) =>
      env.DB.prepare(
        `INSERT INTO audit_events
          (deployment_id, tenant_id, actor_user_id, control_guild_id,
           control_channel_id, action, result_code, occurred_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        deployment,
        env.TENANT_ID,
        "100000000000000004",
        env.CONTROL_GUILD_ID,
        "100000000000000003",
        `event-${index}`,
        "OK",
        now + index,
        now + 60_000
      )
    );
    statements.push(
      env.DB.prepare(
        `INSERT INTO audit_events
          (deployment_id, tenant_id, actor_user_id, control_guild_id,
           control_channel_id, action, result_code, occurred_at, expires_at)
         VALUES (?, ?, ?, ?, ?, 'expired', 'OK', ?, ?)`
      ).bind(
        deployment,
        env.TENANT_ID,
        "100000000000000004",
        env.CONTROL_GUILD_ID,
        "100000000000000003",
        now - 1,
        now - 1
      ),
      env.DB.prepare(
        `INSERT INTO command_receipts
          (command_id, deployment_id, action, accepted, result_code, summary,
           observed_state, occurred_at, expires_at)
         VALUES (?, ?, 'status', 1, 'OK', 'expired', 'CONNECTED', ?, ?)`
      ).bind(crypto.randomUUID(), deployment, now - 1, now - 1)
    );
    await env.DB.batch(statements);

    await purgeExpiredAudit(env as unknown as Env);
    const events = await recentAudit(env as unknown as Env, 999);
    expect(events).toHaveLength(50);
    expect(events.some((event) => event.action === "expired")).toBe(false);
    const receiptCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM command_receipts WHERE expires_at <= ?"
    )
      .bind(Date.now())
      .first<{ count: number }>();
    expect(receiptCount?.count).toBe(0);
  });
});
