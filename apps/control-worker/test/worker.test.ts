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

import { signCommandEnvelope } from "@discord-vc-control/security";

import { authorizeInteraction } from "../src/authorization.js";
import { purgeExpiredAudit, recentAudit } from "../src/audit.js";
import type { DiscordInteraction, Env } from "../src/types.js";

const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] };

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

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
      "SELECT COUNT(*) AS count FROM command_receipts"
    ).first<{ count: number }>();
    expect(receiptCount?.count).toBe(0);
  });
});
