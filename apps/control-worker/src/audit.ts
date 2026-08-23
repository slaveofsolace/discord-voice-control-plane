import type { CommandEnvelope } from "@discord-vc-control/contracts";

import type { Env } from "./types.js";

const retentionMs = 30 * 24 * 60 * 60_000;

export interface AuditRow {
  actor_user_id: string;
  action: string;
  command_id: string | null;
  content_hash: string | null;
  content_length: number | null;
  occurred_at: number;
  result_code: string;
  target_message_id: string | null;
}

export async function writeAudit(
  env: Env,
  envelope: CommandEnvelope,
  input: {
    contentHash?: string;
    contentLength?: number;
    resultCode: string;
    targetMessageId?: string;
  }
): Promise<void> {
  const occurredAt = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO deployments (deployment_id, tenant_id, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(deployment_id) DO UPDATE SET tenant_id = excluded.tenant_id, updated_at = excluded.updated_at`
    ).bind(envelope.deployment_id, envelope.tenant_id, occurredAt, occurredAt),
    env.DB.prepare(
      `INSERT INTO audit_events (
      deployment_id, tenant_id, command_id, actor_user_id, control_guild_id,
      control_channel_id, action, content_hash, content_length, result_code,
      target_message_id, occurred_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      envelope.deployment_id,
      envelope.tenant_id,
      envelope.command_id,
      envelope.actor_user_id,
      envelope.control_guild_id,
      envelope.control_channel_id,
      envelope.action,
      input.contentHash ?? null,
      input.contentLength ?? null,
      input.resultCode,
      input.targetMessageId ?? null,
      occurredAt,
      occurredAt + retentionMs
    )
  ]);
}

export async function recentAudit(env: Env, limit: number): Promise<AuditRow[]> {
  const boundedLimit = Math.min(50, Math.max(1, Math.trunc(limit)));
  const { results } = await env.DB.prepare(
    `SELECT command_id, actor_user_id, action, content_hash, content_length,
            result_code, target_message_id, occurred_at
       FROM audit_events
      WHERE deployment_id = ? AND expires_at > ?
      ORDER BY occurred_at DESC
      LIMIT ?`
  )
    .bind(env.DEPLOYMENT_ID, Date.now(), boundedLimit)
    .all<AuditRow>();
  return results;
}

export async function purgeExpiredAudit(env: Env): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM audit_events WHERE expires_at <= ?").bind(Date.now()),
    env.DB.prepare("DELETE FROM command_receipts WHERE expires_at <= ?").bind(Date.now()),
    env.DB.prepare("DELETE FROM relay_requests WHERE expires_at <= ?").bind(Date.now())
  ]);
}
