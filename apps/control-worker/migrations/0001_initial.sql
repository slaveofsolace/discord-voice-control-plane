PRAGMA foreign_keys = ON;

CREATE TABLE deployments (
  deployment_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  desired_connected INTEGER NOT NULL DEFAULT 0 CHECK (desired_connected IN (0, 1)),
  paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE guild_configs (
  deployment_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  feature_profile TEXT NOT NULL CHECK (feature_profile IN ('presence_only', 'managed_rooms')),
  managed_rooms_enabled INTEGER NOT NULL DEFAULT 0 CHECK (managed_rooms_enabled IN (0, 1)),
  prefix_commands_enabled INTEGER NOT NULL DEFAULT 0 CHECK (prefix_commands_enabled IN (0, 1)),
  category_id TEXT,
  lobby_channel_id TEXT,
  command_channel_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (deployment_id, guild_id),
  FOREIGN KEY (deployment_id) REFERENCES deployments(deployment_id) ON DELETE CASCADE
);

CREATE TABLE managed_voice_channels (
  channel_id TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  settings_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (deployment_id, guild_id, owner_user_id),
  FOREIGN KEY (deployment_id) REFERENCES deployments(deployment_id) ON DELETE CASCADE
);

CREATE TABLE managed_acl (
  channel_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('member', 'role')),
  purpose TEXT NOT NULL CHECK (purpose IN ('owner', 'permit', 'ban', 'lock')),
  allow_bits TEXT NOT NULL DEFAULT '0',
  deny_bits TEXT NOT NULL DEFAULT '0',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (channel_id, subject_id, purpose),
  FOREIGN KEY (channel_id) REFERENCES managed_voice_channels(channel_id) ON DELETE CASCADE
);

CREATE TABLE authorized_targets (
  deployment_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  voice_channel_id TEXT NOT NULL,
  text_channel_id TEXT NOT NULL,
  authorized_by_user_id TEXT NOT NULL,
  authorization_reference TEXT,
  authorized_at INTEGER NOT NULL,
  invalidated_at INTEGER,
  FOREIGN KEY (deployment_id) REFERENCES deployments(deployment_id) ON DELETE CASCADE
);

CREATE TABLE command_receipts (
  command_id TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL,
  action TEXT NOT NULL,
  accepted INTEGER NOT NULL CHECK (accepted IN (0, 1)),
  result_code TEXT NOT NULL,
  summary TEXT NOT NULL,
  observed_state TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (deployment_id) REFERENCES deployments(deployment_id) ON DELETE CASCADE
);

CREATE INDEX command_receipts_expiry ON command_receipts(expires_at);

CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deployment_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  command_id TEXT,
  actor_user_id TEXT NOT NULL,
  control_guild_id TEXT NOT NULL,
  control_channel_id TEXT NOT NULL,
  action TEXT NOT NULL,
  content_hash TEXT,
  content_length INTEGER,
  result_code TEXT NOT NULL,
  target_message_id TEXT,
  occurred_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (deployment_id) REFERENCES deployments(deployment_id) ON DELETE CASCADE
);

CREATE INDEX audit_events_recent ON audit_events(deployment_id, occurred_at DESC);
CREATE INDEX audit_events_expiry ON audit_events(expires_at);
