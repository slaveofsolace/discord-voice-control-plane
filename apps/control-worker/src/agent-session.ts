import { DurableObject } from "cloudflare:workers";

import {
  agentMessageSchema,
  commandEnvelopeSchema,
  managedRoomSettingsSchema,
  type AgentStatus,
  type AgentBootstrap,
  type AgentMessage,
  type CommandAck,
  type CommandStart
} from "@discord-vc-control/contracts";
import {
  agentHandshakePayload,
  verifyAgentHandshake,
  verifyCommandEnvelope
} from "@discord-vc-control/security";

import type { Env, SessionStatus } from "./types.js";

interface SessionRow extends Record<string, SqlStorageValue> {
  status_json: string | null;
  last_heartbeat: number | null;
  last_error: string | null;
}

interface ReceiptRow extends Record<string, SqlStorageValue> {
  ack_json: string;
}

interface PendingRow extends Record<string, SqlStorageValue> {
  envelope_json: string;
}

interface AuditOutboxRow extends Record<string, SqlStorageValue> {
  id: number;
  event_json: string;
}

interface StateOutboxRow extends Record<string, SqlStorageValue> {
  event_json: string;
  state_key: string;
}

type PersistentAgentEvent = Extract<
  AgentMessage,
  { type: "authorized_target_event" | "guild_config_event" | "managed_room_event" }
>;

interface ExpirationRow extends Record<string, SqlStorageValue> {
  expires_at: number | null;
}

const agentHeartbeatStaleMs = 45_000;
const agentSessionLifetimeMs = 5 * 60_000;

export class AgentSession extends DurableObject<Env> {
  constructor(context: DurableObjectState, env: Env) {
    super(context, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS session_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        status_json TEXT,
        last_heartbeat INTEGER,
        last_error TEXT
      );
      INSERT OR IGNORE INTO session_state (id) VALUES (1);
      CREATE TABLE IF NOT EXISTS nonces (
        nonce TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pending_commands (
        command_id TEXT PRIMARY KEY,
        envelope_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS executing_commands (
        command_id TEXT PRIMARY KEY,
        envelope_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS receipts (
        command_id TEXT PRIMARY KEY,
        ack_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS interaction_ids (
        interaction_id TEXT PRIMARY KEY,
        command_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS state_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS state_outbox_v2 (
        state_key TEXT PRIMARY KEY,
        event_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS state_dead_letters (
        state_key TEXT PRIMARY KEY,
        event_json TEXT NOT NULL,
        error_code TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    this.migrateLegacyStateOutbox();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/agent/ws" && request.method === "GET") {
      return this.acceptAgent(request);
    }
    if (url.pathname === "/commands" && request.method === "POST") {
      return this.acceptCommand(request);
    }
    if (url.pathname === "/interactions" && request.method === "POST") {
      return this.claimInteraction(request);
    }
    if (url.pathname.startsWith("/receipts/") && request.method === "GET") {
      return this.getReceipt(url.pathname.slice("/receipts/".length));
    }
    if (url.pathname === "/status" && request.method === "GET") {
      return Response.json(this.status());
    }
    if (url.pathname === "/audit-outbox" && request.method === "POST") {
      return this.storeAuditOutbox(request);
    }
    return new Response("Not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    this.purgeExpiredSessionRows();
    this.enforceAgentSessions();
    let retryAt: number | null = null;
    try {
      await this.flushAuditOutbox();
      await this.flushStateOutbox();
    } catch {
      retryAt = Date.now() + 5_000;
    }
    const next = this.ctx.storage.sql
      .exec<ExpirationRow>(
        `SELECT MIN(expires_at) AS expires_at FROM (
           SELECT expires_at FROM nonces
           UNION ALL SELECT expires_at FROM pending_commands
           UNION ALL SELECT expires_at FROM executing_commands
           UNION ALL SELECT expires_at FROM receipts
           UNION ALL SELECT expires_at FROM interaction_ids
         )`
      )
      .one();
    let nextAt =
      retryAt === null
        ? next.expires_at
        : next.expires_at === null
          ? retryAt
          : Math.min(retryAt, next.expires_at);
    const sessionDeadline = this.nextAgentSessionDeadline();
    if (sessionDeadline !== null) {
      nextAt = nextAt === null ? sessionDeadline : Math.min(nextAt, sessionDeadline);
    }
    if (nextAt !== null) await this.ctx.storage.setAlarm(nextAt);
  }

  async webSocketMessage(webSocket: WebSocket, message: ArrayBuffer | string): Promise<void> {
    try {
      if (!this.agentSocketAuthorized(webSocket)) throw new Error("AGENT_SESSION_EXPIRED");
      if (typeof message !== "string") throw new Error("BINARY_AGENT_MESSAGE_REJECTED");
      const parsed = agentMessageSchema.parse(JSON.parse(message));
      if (parsed.type === "heartbeat") {
        if (parsed.deployment_id !== this.env.DEPLOYMENT_ID) throw new Error("WRONG_DEPLOYMENT");
        this.ctx.storage.sql.exec(
          "UPDATE session_state SET last_heartbeat = ?, last_error = NULL WHERE id = 1",
          Date.now()
        );
        await this.scheduleCleanup(Date.now() + agentHeartbeatStaleMs);
        return;
      }
      if (parsed.type === "status") {
        if (parsed.deployment_id !== this.env.DEPLOYMENT_ID) throw new Error("WRONG_DEPLOYMENT");
        const receivedAt = Date.now();
        this.ctx.storage.sql.exec(
          "UPDATE session_state SET status_json = ?, last_heartbeat = ?, last_error = NULL WHERE id = 1",
          JSON.stringify(parsed),
          receivedAt
        );
        await this.scheduleCleanup(receivedAt + agentHeartbeatStaleMs);
        return;
      }
      if (parsed.type === "ack") {
        await this.storeAck(parsed);
        return;
      }
      if (parsed.type === "command_start") {
        await this.storeCommandStart(webSocket, parsed);
        return;
      }
      if (parsed.type === "managed_room_event") {
        await this.storeStateEvent(parsed);
        return;
      }
      if (parsed.type === "guild_config_event") {
        await this.storeStateEvent(parsed);
        return;
      }
      await this.storeStateEvent(parsed);
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 200) : "INVALID_AGENT_MESSAGE";
      this.ctx.storage.sql.exec("UPDATE session_state SET last_error = ? WHERE id = 1", code);
      webSocket.close(1008, "invalid agent message");
    }
  }

  webSocketClose(): void {
    this.ctx.storage.sql.exec(
      "UPDATE session_state SET last_error = ? WHERE id = 1",
      "AGENT_WEBSOCKET_CLOSED"
    );
  }

  webSocketError(): void {
    this.ctx.storage.sql.exec(
      "UPDATE session_state SET last_error = ? WHERE id = 1",
      "AGENT_WEBSOCKET_ERROR"
    );
  }

  private async acceptAgent(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const agentId = request.headers.get("x-agent-id") ?? "";
    const nonce = request.headers.get("x-agent-nonce") ?? "";
    const timestampText = request.headers.get("x-agent-timestamp") ?? "";
    const kid = request.headers.get("x-agent-key-id") ?? "";
    const signature = request.headers.get("x-agent-signature") ?? "";
    const timestamp = Number(timestampText);
    if (
      agentId !== this.env.DEPLOYMENT_ID ||
      !Number.isSafeInteger(timestamp) ||
      Math.abs(Date.now() - timestamp) > 30_000 ||
      nonce.length < 16 ||
      nonce.length > 128
    ) {
      return new Response("Unauthorized", { status: 401 });
    }
    const secret = this.secretForKid(kid);
    if (secret === undefined) return new Response("Unauthorized", { status: 401 });
    const payload = agentHandshakePayload({
      agentId,
      method: request.method,
      nonce,
      path: "/agent/ws",
      timestamp
    });
    if (
      !(await verifyAgentHandshake(payload, signature, secret)) ||
      !this.consumeNonce(`ws:${nonce}`)
    ) {
      return new Response("Unauthorized", { status: 401 });
    }
    await this.scheduleCleanup(Date.now() + 300_000);
    for (const socket of this.ctx.getWebSockets("agent")) socket.close(1012, "superseded");
    const acceptedAt = Date.now();
    const sessionExpiresAt = acceptedAt + agentSessionLifetimeMs;
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, ["agent", `kid:${kid}`, `expires:${sessionExpiresAt}`]);
    this.ctx.storage.sql.exec(
      "UPDATE session_state SET last_heartbeat = ?, last_error = NULL WHERE id = 1",
      acceptedAt
    );
    await this.scheduleCleanup(Math.min(sessionExpiresAt, acceptedAt + agentHeartbeatStaleMs));
    try {
      await this.sendBootstrap(server);
    } catch (error) {
      server.close(1011, "bootstrap unavailable");
      throw error;
    }
    this.flushPending(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private async acceptCommand(request: Request): Promise<Response> {
    const input: unknown = await request.json();
    const parsed = commandEnvelopeSchema.parse(input);
    const verified = await verifyCommandEnvelope(parsed, {
      secretsByKeyId: this.secretsByKeyId()
    });
    if (verified.deployment_id !== this.env.DEPLOYMENT_ID) {
      return Response.json({ error: "WRONG_DEPLOYMENT" }, { status: 409 });
    }
    if (verified.tenant_id !== this.env.TENANT_ID) {
      return Response.json({ error: "WRONG_TENANT" }, { status: 409 });
    }
    this.purgeExpiredSessionRows();
    const existing = this.receipt(verified.command_id);
    if (existing !== null) {
      return Response.json({ queued: false, duplicate: true, receipt: existing });
    }
    const existingPending = this.ctx.storage.sql
      .exec<{ command_id: string }>(
        "SELECT command_id FROM pending_commands WHERE command_id = ?",
        verified.command_id
      )
      .toArray()[0];
    if (existingPending !== undefined) return Response.json({ queued: true, duplicate: true });
    const existingExecution = this.ctx.storage.sql
      .exec<{ command_id: string }>(
        "SELECT command_id FROM executing_commands WHERE command_id = ?",
        verified.command_id
      )
      .toArray()[0];
    if (existingExecution !== undefined) {
      return Response.json({ queued: false, duplicate: true, executing: true });
    }
    if (!this.consumeNonce(verified.nonce)) {
      return Response.json({ error: "COMMAND_REPLAY" }, { status: 409 });
    }
    this.ctx.storage.sql.exec(
      "INSERT INTO pending_commands (command_id, envelope_json, expires_at) VALUES (?, ?, ?)",
      verified.command_id,
      JSON.stringify(verified),
      verified.expires_at
    );
    await this.scheduleCleanup(verified.expires_at);
    await this.storeDesiredState(verified.action);
    const socket = this.ctx.getWebSockets("agent")[0];
    if (socket !== undefined) socket.send(JSON.stringify(verified));
    return Response.json({ queued: true, duplicate: false, agentConnected: socket !== undefined });
  }

  private async claimInteraction(request: Request): Promise<Response> {
    const input: unknown = await request.json();
    if (
      typeof input !== "object" ||
      input === null ||
      !("interaction_id" in input) ||
      typeof input.interaction_id !== "string" ||
      !/^\d{17,20}$/u.test(input.interaction_id) ||
      !("command_id" in input) ||
      typeof input.command_id !== "string" ||
      !/^[a-f\d]{8}-[a-f\d]{4}-5[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/iu.test(input.command_id)
    ) {
      return new Response("Invalid interaction claim", { status: 400 });
    }
    this.purgeExpiredSessionRows();
    const existing = this.ctx.storage.sql
      .exec<{ command_id: string }>(
        "SELECT command_id FROM interaction_ids WHERE interaction_id = ?",
        input.interaction_id
      )
      .toArray()[0];
    if (existing !== undefined) {
      if (existing.command_id !== input.command_id) {
        return Response.json({ error: "INTERACTION_ID_COLLISION" }, { status: 409 });
      }
      return Response.json({ duplicate: true, command_id: existing.command_id });
    }
    const expiresAt = Date.now() + 24 * 60 * 60_000;
    this.ctx.storage.sql.exec(
      "INSERT INTO interaction_ids (interaction_id, command_id, expires_at) VALUES (?, ?, ?)",
      input.interaction_id,
      input.command_id,
      expiresAt
    );
    await this.scheduleCleanup(expiresAt);
    return Response.json({ duplicate: false, command_id: input.command_id });
  }

  private getReceipt(commandId: string): Response {
    if (!/^[a-f\d-]{36}$/iu.test(commandId)) return new Response("Bad command id", { status: 400 });
    this.purgeExpiredSessionRows();
    const receipt = this.receipt(commandId);
    return receipt === null ? new Response(null, { status: 404 }) : Response.json(receipt);
  }

  private receipt(commandId: string): CommandAck | null {
    const row = this.ctx.storage.sql
      .exec<ReceiptRow>(
        "SELECT ack_json FROM receipts WHERE command_id = ? AND expires_at > ?",
        commandId,
        Date.now()
      )
      .toArray()[0];
    return row === undefined ? null : (JSON.parse(row.ack_json) as CommandAck);
  }

  private async storeAck(ack: CommandAck): Promise<void> {
    this.purgeExpiredSessionRows();
    const executing = this.ctx.storage.sql
      .exec<PendingRow>(
        "SELECT envelope_json FROM executing_commands WHERE command_id = ?",
        ack.command_id
      )
      .toArray()[0];
    if (executing === undefined) return;
    const envelope = commandEnvelopeSchema.parse(JSON.parse(executing.envelope_json));
    const expiresAt = Date.now() + 24 * 60 * 60_000;
    this.ctx.storage.sql.exec(
      `INSERT INTO receipts (command_id, ack_json, expires_at) VALUES (?, ?, ?)
       ON CONFLICT(command_id) DO NOTHING`,
      ack.command_id,
      JSON.stringify(ack),
      expiresAt
    );
    await this.scheduleCleanup(expiresAt);
    this.ctx.storage.sql.exec(
      "DELETE FROM executing_commands WHERE command_id = ?",
      ack.command_id
    );
    await this.ensureDeployment();
    await this.env.DB.batch([
      this.env.DB.prepare(
        `INSERT OR IGNORE INTO command_receipts
          (command_id, deployment_id, action, accepted, result_code, summary,
           observed_state, occurred_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        ack.command_id,
        this.env.DEPLOYMENT_ID,
        envelope.action,
        ack.accepted ? 1 : 0,
        ack.result_code,
        ack.summary,
        ack.observed_state,
        ack.occurred_at,
        expiresAt
      ),
      this.env.DB.prepare(
        `UPDATE audit_events
            SET result_code = ?, target_message_id = COALESCE(?, target_message_id)
          WHERE deployment_id = ? AND command_id = ?`
      ).bind(ack.result_code, ack.target_message_id ?? null, this.env.DEPLOYMENT_ID, ack.command_id)
    ]);
  }

  private async storeCommandStart(socket: WebSocket, start: CommandStart): Promise<void> {
    if (start.deployment_id !== this.env.DEPLOYMENT_ID) throw new Error("WRONG_DEPLOYMENT");
    this.purgeExpiredSessionRows();
    const existingReceipt = this.receipt(start.command_id);
    const existingExecution = this.ctx.storage.sql
      .exec<{ command_id: string }>(
        "SELECT command_id FROM executing_commands WHERE command_id = ?",
        start.command_id
      )
      .toArray()[0];
    if (existingReceipt !== null || existingExecution !== undefined) {
      socket.send(
        JSON.stringify({
          type: "command_start_ack",
          command_id: start.command_id,
          deployment_id: this.env.DEPLOYMENT_ID,
          accepted: false,
          duplicate: true
        })
      );
      return;
    }
    const pending = this.ctx.storage.sql
      .exec<PendingRow>(
        "SELECT envelope_json FROM pending_commands WHERE command_id = ?",
        start.command_id
      )
      .toArray()[0];
    if (pending === undefined) {
      socket.send(
        JSON.stringify({
          type: "command_start_ack",
          command_id: start.command_id,
          deployment_id: this.env.DEPLOYMENT_ID,
          accepted: false,
          duplicate: true
        })
      );
      return;
    }
    const expiresAt = Date.now() + 24 * 60 * 60_000;
    this.ctx.storage.sql.exec(
      "INSERT INTO executing_commands (command_id, envelope_json, expires_at) VALUES (?, ?, ?)",
      start.command_id,
      pending.envelope_json,
      expiresAt
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM pending_commands WHERE command_id = ?",
      start.command_id
    );
    await this.scheduleCleanup(expiresAt);
    socket.send(
      JSON.stringify({
        type: "command_start_ack",
        command_id: start.command_id,
        deployment_id: this.env.DEPLOYMENT_ID,
        accepted: true,
        duplicate: false
      })
    );
  }

  private async ensureDeployment(): Promise<void> {
    const now = Date.now();
    await this.env.DB.prepare(
      `INSERT INTO deployments (deployment_id, tenant_id, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(deployment_id) DO UPDATE SET tenant_id = excluded.tenant_id, updated_at = excluded.updated_at`
    )
      .bind(this.env.DEPLOYMENT_ID, this.env.TENANT_ID, now, now)
      .run();
  }

  private async sendBootstrap(socket: WebSocket): Promise<void> {
    await this.ensureDeployment();
    await this.flushAuditOutbox();
    await this.flushStateOutbox();
    const [deployments, configs, rooms, targets] = await Promise.all([
      this.env.DB.prepare(
        "SELECT desired_connected, paused FROM deployments WHERE deployment_id = ? LIMIT 1"
      )
        .bind(this.env.DEPLOYMENT_ID)
        .all(),
      this.env.DB.prepare(
        `SELECT deployment_id, guild_id, feature_profile, managed_rooms_enabled,
                prefix_commands_enabled, category_id, lobby_channel_id, command_channel_id
           FROM guild_configs WHERE deployment_id = ?`
      )
        .bind(this.env.DEPLOYMENT_ID)
        .all(),
      this.env.DB.prepare(
        `SELECT channel_id, deployment_id, guild_id, owner_user_id, category_id, settings_json
           FROM managed_voice_channels WHERE deployment_id = ?`
      )
        .bind(this.env.DEPLOYMENT_ID)
        .all(),
      this.env.DB.prepare(
        `SELECT deployment_id, guild_id, voice_channel_id, text_channel_id,
                authorized_by_user_id, authorized_at
           FROM authorized_targets
          WHERE deployment_id = ? AND invalidated_at IS NULL LIMIT 1`
      )
        .bind(this.env.DEPLOYMENT_ID)
        .all()
    ]);
    const bootstrap: AgentBootstrap = {
      type: "bootstrap",
      deployment_id: this.env.DEPLOYMENT_ID,
      tenant_id: this.env.TENANT_ID,
      desired_connected: Number(deployments.results[0]?.desired_connected ?? 0) === 1,
      paused: Number(deployments.results[0]?.paused ?? 0) === 1,
      guild_configs: configs.results.map((row) => ({
        deployment_id: String(row.deployment_id),
        guild_id: String(row.guild_id),
        feature_profile:
          row.feature_profile === "managed_rooms" ? "managed_rooms" : "presence_only",
        managed_rooms_enabled: Number(row.managed_rooms_enabled) === 1,
        prefix_commands_enabled: Number(row.prefix_commands_enabled) === 1,
        category_id: typeof row.category_id === "string" ? row.category_id : null,
        lobby_channel_id: typeof row.lobby_channel_id === "string" ? row.lobby_channel_id : null,
        command_channel_id:
          typeof row.command_channel_id === "string" ? row.command_channel_id : null
      })),
      managed_rooms: rooms.results.map((row) => ({
        channel_id: String(row.channel_id),
        deployment_id: String(row.deployment_id),
        guild_id: String(row.guild_id),
        owner_user_id: String(row.owner_user_id),
        category_id: String(row.category_id),
        settings: managedRoomSettingsSchema.parse(JSON.parse(String(row.settings_json)))
      })),
      authorized_target:
        targets.results[0] === undefined
          ? null
          : {
              deployment_id: String(targets.results[0].deployment_id),
              guild_id: String(targets.results[0].guild_id),
              voice_channel_id: String(targets.results[0].voice_channel_id),
              text_channel_id: String(targets.results[0].text_channel_id),
              authorized_by_user_id: String(targets.results[0].authorized_by_user_id),
              authorized_at: Number(targets.results[0].authorized_at)
            }
    };
    socket.send(JSON.stringify(bootstrap));
  }

  private async storeDesiredState(action: string): Promise<void> {
    await this.ensureDeployment();
    const now = Date.now();
    if (action === "join" || action === "reconnect" || action === "resume") {
      await this.env.DB.prepare(
        "UPDATE deployments SET desired_connected = 1, paused = 0, updated_at = ? WHERE deployment_id = ?"
      )
        .bind(now, this.env.DEPLOYMENT_ID)
        .run();
    } else if (action === "leave") {
      await this.env.DB.prepare(
        "UPDATE deployments SET desired_connected = 0, paused = 0, updated_at = ? WHERE deployment_id = ?"
      )
        .bind(now, this.env.DEPLOYMENT_ID)
        .run();
    } else if (action === "pause") {
      await this.env.DB.prepare(
        "UPDATE deployments SET paused = 1, updated_at = ? WHERE deployment_id = ?"
      )
        .bind(now, this.env.DEPLOYMENT_ID)
        .run();
    }
  }

  private async storeGuildConfig(config: {
    category_id: string | null;
    command_channel_id: string | null;
    deployment_id: string;
    feature_profile: "managed_rooms" | "presence_only";
    guild_id: string;
    lobby_channel_id: string | null;
    managed_rooms_enabled: boolean;
    prefix_commands_enabled: boolean;
  }): Promise<void> {
    if (config.deployment_id !== this.env.DEPLOYMENT_ID) throw new Error("WRONG_DEPLOYMENT");
    await this.ensureDeployment();
    const now = Date.now();
    await this.env.DB.prepare(
      `INSERT INTO guild_configs
        (deployment_id, guild_id, feature_profile, managed_rooms_enabled,
         prefix_commands_enabled, category_id, lobby_channel_id, command_channel_id,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(deployment_id, guild_id) DO UPDATE SET
         feature_profile = excluded.feature_profile,
         managed_rooms_enabled = excluded.managed_rooms_enabled,
         prefix_commands_enabled = excluded.prefix_commands_enabled,
         category_id = excluded.category_id,
         lobby_channel_id = excluded.lobby_channel_id,
         command_channel_id = excluded.command_channel_id,
         updated_at = excluded.updated_at`
    )
      .bind(
        config.deployment_id,
        config.guild_id,
        config.feature_profile,
        config.managed_rooms_enabled ? 1 : 0,
        config.prefix_commands_enabled ? 1 : 0,
        config.category_id,
        config.lobby_channel_id,
        config.command_channel_id,
        now,
        now
      )
      .run();
  }

  private async syncManagedAcl(room: {
    channel_id: string;
    guild_id: string;
    owner_user_id: string;
    settings: {
      banned_user_ids: string[];
      locked: boolean;
      permitted_user_ids: string[];
    };
  }): Promise<void> {
    const connect = "1048576";
    const viewAndConnect = "1049600";
    const statements = [
      this.env.DB.prepare("DELETE FROM managed_acl WHERE channel_id = ?").bind(room.channel_id),
      this.env.DB.prepare(
        `INSERT INTO managed_acl
          (channel_id, subject_id, subject_type, purpose, allow_bits, deny_bits, updated_at)
         VALUES (?, ?, 'member', 'owner', ?, '0', ?)`
      ).bind(room.channel_id, room.owner_user_id, viewAndConnect, Date.now())
    ];
    for (const userId of room.settings.permitted_user_ids) {
      statements.push(
        this.env.DB.prepare(
          `INSERT INTO managed_acl
            (channel_id, subject_id, subject_type, purpose, allow_bits, deny_bits, updated_at)
           VALUES (?, ?, 'member', 'permit', ?, '0', ?)`
        ).bind(room.channel_id, userId, connect, Date.now())
      );
    }
    for (const userId of room.settings.banned_user_ids) {
      statements.push(
        this.env.DB.prepare(
          `INSERT INTO managed_acl
            (channel_id, subject_id, subject_type, purpose, allow_bits, deny_bits, updated_at)
           VALUES (?, ?, 'member', 'ban', '0', ?, ?)`
        ).bind(room.channel_id, userId, connect, Date.now())
      );
    }
    if (room.settings.locked) {
      statements.push(
        this.env.DB.prepare(
          `INSERT INTO managed_acl
            (channel_id, subject_id, subject_type, purpose, allow_bits, deny_bits, updated_at)
           VALUES (?, ?, 'role', 'lock', '0', ?, ?)`
        ).bind(room.channel_id, room.guild_id, connect, Date.now())
      );
    }
    await this.env.DB.batch(statements);
  }

  private async storeManagedRoomEvent(
    event:
      | {
          type: "managed_room_event";
          operation: "upsert";
          room: {
            channel_id: string;
            deployment_id: string;
            guild_id: string;
            owner_user_id: string;
            category_id: string;
            settings: unknown;
          };
        }
      | {
          type: "managed_room_event";
          operation: "delete";
          deployment_id: string;
          guild_id: string;
          channel_id: string;
          occurred_at: number;
        }
  ): Promise<void> {
    const deploymentId =
      event.operation === "upsert" ? event.room.deployment_id : event.deployment_id;
    if (deploymentId !== this.env.DEPLOYMENT_ID) throw new Error("WRONG_DEPLOYMENT");
    if (event.operation === "delete") {
      await this.env.DB.prepare(
        "DELETE FROM managed_voice_channels WHERE deployment_id = ? AND guild_id = ? AND channel_id = ?"
      )
        .bind(event.deployment_id, event.guild_id, event.channel_id)
        .run();
      return;
    }
    await this.ensureDeployment();
    const settings = managedRoomSettingsSchema.parse(event.room.settings);
    const now = Date.now();
    const conflictingOwner = await this.env.DB.prepare(
      `SELECT channel_id FROM managed_voice_channels
        WHERE deployment_id = ? AND guild_id = ? AND owner_user_id = ? AND channel_id <> ?
        LIMIT 1`
    )
      .bind(
        event.room.deployment_id,
        event.room.guild_id,
        event.room.owner_user_id,
        event.room.channel_id
      )
      .first<{ channel_id: string }>();
    if (conflictingOwner !== null) throw new Error("OWNER_ALREADY_HAS_ROOM");
    await this.env.DB.prepare(
      `INSERT INTO managed_voice_channels
        (channel_id, deployment_id, guild_id, owner_user_id, category_id,
         settings_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(channel_id) DO UPDATE SET
         owner_user_id = excluded.owner_user_id,
         settings_json = excluded.settings_json,
         updated_at = excluded.updated_at`
    )
      .bind(
        event.room.channel_id,
        event.room.deployment_id,
        event.room.guild_id,
        event.room.owner_user_id,
        event.room.category_id,
        JSON.stringify(settings),
        now,
        now
      )
      .run();
    await this.syncManagedAcl({ ...event.room, settings });
  }

  private async storeAuthorizedTarget(target: {
    authorized_at: number;
    authorized_by_user_id: string;
    deployment_id: string;
    guild_id: string;
    text_channel_id: string;
    voice_channel_id: string;
  }): Promise<void> {
    if (target.deployment_id !== this.env.DEPLOYMENT_ID) throw new Error("WRONG_DEPLOYMENT");
    await this.ensureDeployment();
    await this.env.DB.prepare(
      `INSERT INTO authorized_targets
        (deployment_id, guild_id, voice_channel_id, text_channel_id,
         authorized_by_user_id, authorized_at, invalidated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(deployment_id) DO UPDATE SET
         guild_id = excluded.guild_id,
         voice_channel_id = excluded.voice_channel_id,
         text_channel_id = excluded.text_channel_id,
         authorized_by_user_id = excluded.authorized_by_user_id,
         authorized_at = excluded.authorized_at,
         invalidated_at = NULL`
    )
      .bind(
        target.deployment_id,
        target.guild_id,
        target.voice_channel_id,
        target.text_channel_id,
        target.authorized_by_user_id,
        target.authorized_at
      )
      .run();
  }

  private status(): SessionStatus {
    this.purgeExpiredSessionRows();
    this.enforceAgentSessions();
    const row = this.ctx.storage.sql
      .exec<SessionRow>(
        "SELECT status_json, last_heartbeat, last_error FROM session_state WHERE id = 1"
      )
      .one();
    const status = row?.status_json ? (JSON.parse(row.status_json) as AgentStatus) : null;
    const pending = this.ctx.storage.sql
      .exec<{ count: number }>(
        `SELECT
           (SELECT COUNT(*) FROM pending_commands WHERE expires_at > ?) +
           (SELECT COUNT(*) FROM executing_commands WHERE expires_at > ?) AS count`,
        Date.now(),
        Date.now()
      )
      .one();
    return {
      agentConnected: this.ctx.getWebSockets("agent").length === 1,
      heartbeatStale:
        row?.last_heartbeat === null ||
        row?.last_heartbeat === undefined ||
        Date.now() - row.last_heartbeat > agentHeartbeatStaleMs,
      lastHeartbeat: row?.last_heartbeat ?? null,
      status,
      pendingCommands: pending?.count ?? 0,
      lastError: row?.last_error ?? null
    };
  }

  private async storeAuditOutbox(request: Request): Promise<Response> {
    const event = await request.text();
    if (event.length > 4000) return new Response("Too large", { status: 413 });
    try {
      await this.ensureDeployment();
      await this.persistAuditEvent(JSON.parse(event) as Record<string, unknown>);
      return new Response(null, { status: 204 });
    } catch {
      // D1 can be temporarily unavailable; retain only the bounded, redacted event.
    }
    const pending = this.ctx.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM audit_outbox")
      .one().count;
    if (pending >= 100) {
      this.ctx.storage.sql.exec(
        "UPDATE session_state SET last_error = ? WHERE id = 1",
        "AUDIT_OUTBOX_FULL"
      );
      return new Response("Audit storage unavailable", { status: 507 });
    }
    this.ctx.storage.sql.exec(
      "INSERT INTO audit_outbox (event_json, created_at) VALUES (?, ?)",
      event,
      Date.now()
    );
    await this.scheduleCleanup(Date.now() + 5_000);
    return new Response(null, { status: 204 });
  }

  private async flushAuditOutbox(): Promise<void> {
    for (const row of this.ctx.storage.sql.exec<AuditOutboxRow>(
      "SELECT id, event_json FROM audit_outbox ORDER BY id LIMIT 100"
    )) {
      await this.persistAuditEvent(JSON.parse(row.event_json) as Record<string, unknown>);
      this.ctx.storage.sql.exec("DELETE FROM audit_outbox WHERE id = ?", row.id);
    }
    this.ctx.storage.sql.exec(
      `UPDATE session_state
          SET last_error = CASE WHEN last_error = 'AUDIT_OUTBOX_FULL' THEN NULL ELSE last_error END
        WHERE id = 1`
    );
  }

  private async storeStateEvent(event: PersistentAgentEvent): Promise<void> {
    const deploymentId =
      event.type === "managed_room_event"
        ? event.operation === "upsert"
          ? event.room.deployment_id
          : event.deployment_id
        : event.type === "guild_config_event"
          ? event.config.deployment_id
          : event.target.deployment_id;
    if (deploymentId !== this.env.DEPLOYMENT_ID) throw new Error("WRONG_DEPLOYMENT");
    const stateKey = this.stateEventKey(event);
    const pending = this.ctx.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM state_outbox_v2")
      .one().count;
    const blocked = this.ctx.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM state_dead_letters")
      .one().count;
    if (pending === 0 && blocked === 0) {
      try {
        await this.persistStateEvent(event);
        this.ctx.storage.sql.exec("DELETE FROM state_dead_letters WHERE state_key = ?", stateKey);
        return;
      } catch {
        // Preserve ordering by putting the first failed write into the same queue as later events.
      }
    }
    const existing = this.ctx.storage.sql
      .exec<{ state_key: string }>(
        "SELECT state_key FROM state_outbox_v2 WHERE state_key = ?",
        stateKey
      )
      .toArray()[0];
    if (pending >= 1000 && existing === undefined) {
      this.ctx.storage.sql.exec(
        "UPDATE session_state SET last_error = ? WHERE id = 1",
        "STATE_OUTBOX_FULL"
      );
      throw new Error("STATE_OUTBOX_FULL");
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO state_outbox_v2 (state_key, event_json, created_at) VALUES (?, ?, ?)
       ON CONFLICT(state_key) DO UPDATE SET
         event_json = excluded.event_json,
         created_at = excluded.created_at`,
      stateKey,
      JSON.stringify(event),
      Date.now()
    );
    this.ctx.storage.sql.exec(
      "UPDATE session_state SET last_error = ? WHERE id = 1",
      "D1_STATE_EVENT_QUEUED"
    );
    await this.scheduleCleanup(Date.now() + 5_000);
    await this.flushStateOutbox().catch(() => undefined);
  }

  private async flushStateOutbox(): Promise<void> {
    for (const row of this.ctx.storage.sql.exec<StateOutboxRow>(
      "SELECT state_key, event_json FROM state_outbox_v2 ORDER BY created_at, state_key LIMIT 1000"
    )) {
      const candidate = agentMessageSchema.safeParse(JSON.parse(row.event_json));
      if (
        !candidate.success ||
        (candidate.data.type !== "managed_room_event" &&
          candidate.data.type !== "guild_config_event" &&
          candidate.data.type !== "authorized_target_event")
      ) {
        this.deadLetterStateEvent(row, "INVALID_STATE_OUTBOX_EVENT");
        continue;
      }
      try {
        await this.persistStateEvent(candidate.data);
        this.ctx.storage.sql.exec("DELETE FROM state_outbox_v2 WHERE state_key = ?", row.state_key);
        this.ctx.storage.sql.exec(
          "DELETE FROM state_dead_letters WHERE state_key = ?",
          row.state_key
        );
      } catch (error) {
        const code = error instanceof Error ? error.message : "STATE_PERSIST_FAILED";
        if (code === "OWNER_ALREADY_HAS_ROOM" || code === "WRONG_DEPLOYMENT") {
          this.deadLetterStateEvent(row, code);
          continue;
        }
        throw error;
      }
    }
    const deadLetters = this.ctx.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM state_dead_letters")
      .one().count;
    if (deadLetters > 0) {
      this.ctx.storage.sql.exec(
        "UPDATE session_state SET last_error = ? WHERE id = 1",
        "STATE_RECONCILIATION_BLOCKED"
      );
      throw new Error("STATE_RECONCILIATION_BLOCKED");
    }
    this.ctx.storage.sql.exec(
      `UPDATE session_state
          SET last_error = CASE
            WHEN last_error IN ('D1_STATE_EVENT_QUEUED', 'STATE_OUTBOX_FULL') THEN NULL
            ELSE last_error
          END
        WHERE id = 1`
    );
  }

  private deadLetterStateEvent(row: StateOutboxRow, code: string): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO state_dead_letters (state_key, event_json, error_code, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(state_key) DO UPDATE SET
         event_json = excluded.event_json,
         error_code = excluded.error_code,
         created_at = excluded.created_at`,
      row.state_key,
      row.event_json,
      code.slice(0, 120),
      Date.now()
    );
    this.ctx.storage.sql.exec("DELETE FROM state_outbox_v2 WHERE state_key = ?", row.state_key);
  }

  private stateEventKey(event: PersistentAgentEvent): string {
    if (event.type === "authorized_target_event") return `target:${event.target.deployment_id}`;
    if (event.type === "guild_config_event") return `guild:${event.config.guild_id}`;
    const channelId = event.operation === "upsert" ? event.room.channel_id : event.channel_id;
    return `room:${channelId}`;
  }

  private migrateLegacyStateOutbox(): void {
    for (const row of this.ctx.storage.sql.exec<{ event_json: string; id: number }>(
      "SELECT id, event_json FROM state_outbox ORDER BY id"
    )) {
      let input: unknown;
      try {
        input = JSON.parse(row.event_json);
      } catch {
        input = null;
      }
      const parsed = agentMessageSchema.safeParse(input);
      if (
        !parsed.success ||
        (parsed.data.type !== "managed_room_event" &&
          parsed.data.type !== "guild_config_event" &&
          parsed.data.type !== "authorized_target_event")
      ) {
        this.ctx.storage.sql.exec(
          `INSERT OR REPLACE INTO state_dead_letters
            (state_key, event_json, error_code, created_at) VALUES (?, ?, ?, ?)`,
          `legacy:${row.id}`,
          row.event_json,
          "INVALID_LEGACY_STATE_OUTBOX_EVENT",
          Date.now()
        );
      } else {
        const stateKey = this.stateEventKey(parsed.data);
        this.ctx.storage.sql.exec(
          `INSERT INTO state_outbox_v2 (state_key, event_json, created_at) VALUES (?, ?, ?)
           ON CONFLICT(state_key) DO UPDATE SET
             event_json = excluded.event_json,
             created_at = excluded.created_at`,
          stateKey,
          row.event_json,
          Date.now()
        );
      }
      this.ctx.storage.sql.exec("DELETE FROM state_outbox WHERE id = ?", row.id);
    }
  }

  private async persistStateEvent(event: PersistentAgentEvent): Promise<void> {
    if (event.type === "managed_room_event") {
      await this.storeManagedRoomEvent(event);
      return;
    }
    if (event.type === "guild_config_event") {
      await this.storeGuildConfig(event.config);
      return;
    }
    await this.storeAuthorizedTarget(event.target);
  }

  private async persistAuditEvent(event: Record<string, unknown>): Promise<void> {
    if (
      event.deployment_id !== this.env.DEPLOYMENT_ID ||
      event.tenant_id !== this.env.TENANT_ID ||
      typeof event.command_id !== "string" ||
      typeof event.actor_user_id !== "string" ||
      typeof event.control_guild_id !== "string" ||
      typeof event.control_channel_id !== "string" ||
      typeof event.action !== "string" ||
      typeof event.result_code !== "string" ||
      typeof event.occurred_at !== "number" ||
      typeof event.expires_at !== "number"
    ) {
      throw new Error("INVALID_AUDIT_OUTBOX_EVENT");
    }
    await this.env.DB.prepare(
      `INSERT INTO audit_events
        (deployment_id, tenant_id, command_id, actor_user_id, control_guild_id,
         control_channel_id, action, content_hash, content_length, result_code,
         target_message_id, occurred_at, expires_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM audit_events WHERE command_id = ?)`
    )
      .bind(
        event.deployment_id,
        event.tenant_id,
        event.command_id,
        event.actor_user_id,
        event.control_guild_id,
        event.control_channel_id,
        event.action,
        event.content_hash ?? null,
        event.content_length ?? null,
        event.result_code,
        event.target_message_id ?? null,
        event.occurred_at,
        event.expires_at,
        event.command_id
      )
      .run();
  }

  private consumeNonce(nonce: string): boolean {
    const now = Date.now();
    this.ctx.storage.sql.exec("DELETE FROM nonces WHERE expires_at <= ?", now);
    const existing = this.ctx.storage.sql
      .exec<{ nonce: string }>("SELECT nonce FROM nonces WHERE nonce = ?", nonce)
      .toArray()[0];
    if (existing !== undefined) return false;
    this.ctx.storage.sql.exec(
      "INSERT INTO nonces (nonce, expires_at) VALUES (?, ?)",
      nonce,
      now + 300_000
    );
    return true;
  }

  private purgeExpiredSessionRows(now = Date.now()): void {
    this.ctx.storage.sql.exec("DELETE FROM nonces WHERE expires_at <= ?", now);
    this.ctx.storage.sql.exec("DELETE FROM pending_commands WHERE expires_at <= ?", now);
    this.ctx.storage.sql.exec("DELETE FROM executing_commands WHERE expires_at <= ?", now);
    this.ctx.storage.sql.exec("DELETE FROM receipts WHERE expires_at <= ?", now);
    this.ctx.storage.sql.exec("DELETE FROM interaction_ids WHERE expires_at <= ?", now);
  }

  private async scheduleCleanup(expiresAt: number): Promise<void> {
    const scheduled = await this.ctx.storage.getAlarm();
    if (scheduled === null || expiresAt < scheduled) await this.ctx.storage.setAlarm(expiresAt);
  }

  private secretForKid(kid: string): string | undefined {
    if (kid === this.env.AGENT_KEY_ID) return this.env.AGENT_AUTH_SECRET;
    if (kid === this.env.AGENT_PREVIOUS_KEY_ID) return this.env.AGENT_PREVIOUS_AUTH_SECRET;
    return undefined;
  }

  private agentSocketAuthorized(socket: WebSocket, now = Date.now()): boolean {
    const tags = this.ctx.getTags(socket);
    const kid = tags.find((tag) => tag.startsWith("kid:"))?.slice("kid:".length);
    const expiresAt = Number(
      tags.find((tag) => tag.startsWith("expires:"))?.slice("expires:".length)
    );
    return (
      kid !== undefined &&
      this.secretForKid(kid) !== undefined &&
      Number.isSafeInteger(expiresAt) &&
      expiresAt > now
    );
  }

  private enforceAgentSessions(now = Date.now()): void {
    const heartbeat = this.ctx.storage.sql
      .exec<{ last_heartbeat: number | null }>(
        "SELECT last_heartbeat FROM session_state WHERE id = 1"
      )
      .one().last_heartbeat;
    for (const socket of this.ctx.getWebSockets("agent")) {
      const authorized = this.agentSocketAuthorized(socket, now);
      const stale = heartbeat === null || now - heartbeat > agentHeartbeatStaleMs;
      if (!authorized || stale) {
        socket.close(1008, authorized ? "stale agent session" : "agent session expired");
        this.ctx.storage.sql.exec(
          "UPDATE session_state SET last_error = ? WHERE id = 1",
          authorized ? "AGENT_HEARTBEAT_STALE" : "AGENT_SESSION_EXPIRED"
        );
      }
    }
  }

  private nextAgentSessionDeadline(now = Date.now()): number | null {
    const socket = this.ctx.getWebSockets("agent")[0];
    if (socket === undefined) return null;
    const tags = this.ctx.getTags(socket);
    const expiresAt = Number(
      tags.find((tag) => tag.startsWith("expires:"))?.slice("expires:".length)
    );
    const heartbeat = this.ctx.storage.sql
      .exec<{ last_heartbeat: number | null }>(
        "SELECT last_heartbeat FROM session_state WHERE id = 1"
      )
      .one().last_heartbeat;
    const heartbeatDeadline = (heartbeat ?? now) + agentHeartbeatStaleMs;
    return Number.isSafeInteger(expiresAt)
      ? Math.min(expiresAt, heartbeatDeadline)
      : heartbeatDeadline;
  }

  private secretsByKeyId(): ReadonlyMap<string, string> {
    const secrets = new Map([[this.env.AGENT_KEY_ID, this.env.AGENT_AUTH_SECRET]]);
    if (this.env.AGENT_PREVIOUS_KEY_ID && this.env.AGENT_PREVIOUS_AUTH_SECRET) {
      secrets.set(this.env.AGENT_PREVIOUS_KEY_ID, this.env.AGENT_PREVIOUS_AUTH_SECRET);
    }
    return secrets;
  }

  private flushPending(socket: WebSocket): void {
    const now = Date.now();
    this.purgeExpiredSessionRows(now);
    for (const row of this.ctx.storage.sql.exec<{ envelope_json: string }>(
      "SELECT envelope_json FROM pending_commands WHERE expires_at > ? ORDER BY expires_at",
      now
    )) {
      socket.send(row.envelope_json);
    }
  }
}
