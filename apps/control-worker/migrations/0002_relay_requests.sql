CREATE TABLE relay_requests (
  request_id TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  control_guild_id TEXT NOT NULL,
  control_channel_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  content_length INTEGER NOT NULL,
  content_kind TEXT NOT NULL CHECK (content_kind IN ('ordinary_chat', 'voice_command')),
  risk TEXT NOT NULL CHECK (risk IN ('OPERATOR', 'ELEVATED')),
  status TEXT NOT NULL,
  result_code TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (deployment_id) REFERENCES deployments(deployment_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX relay_requests_source
  ON relay_requests(deployment_id, application_id, source_message_id);
CREATE INDEX relay_requests_expiry ON relay_requests(expires_at);
