import type { AgentStatus } from "@discord-vc-control/contracts";

export interface Env {
  AGENT_SESSION: DurableObjectNamespace;
  DB: D1Database;
  DEPLOYMENT_ID: string;
  TENANT_ID: string;
  CONTROL_DISCORD_APPLICATION_ID: string;
  CONTROL_DISCORD_PUBLIC_KEY: string;
  CONTROL_GUILD_ID: string;
  CONTROL_CHANNEL_IDS: string;
  CONTROL_OPERATOR_USER_IDS: string;
  CONTROL_OPERATOR_ROLE_IDS: string;
  CONTROL_ELEVATED_USER_IDS: string;
  CONTROL_ELEVATED_ROLE_IDS: string;
  CONTROL_RELAY_ENABLED: string;
  CONTROL_RELAY_APPLICATION_ID: string;
  CONTROL_RELAY_CHANNEL_ID: string;
  AGENT_KEY_ID: string;
  AGENT_AUTH_SECRET: string;
  AGENT_PREVIOUS_KEY_ID?: string;
  AGENT_PREVIOUS_AUTH_SECRET?: string;
  INTERNAL_STATUS_SECRET: string;
  RELAY_INGRESS_HMAC_SECRET: string;
}

export interface DiscordInteraction {
  id: string;
  application_id: string;
  type: number;
  token: string;
  guild_id?: string;
  channel_id?: string;
  data?: {
    name?: string;
    options?: {
      name: string;
      type: number;
      value?: string | number | boolean;
      options?: { name: string; type: number; value?: string | number | boolean }[];
    }[];
  };
  member?: {
    roles?: string[];
    user?: { id: string };
  };
  user?: { id: string };
}

export interface SessionStatus {
  agentConnected: boolean;
  heartbeatStale: boolean;
  lastHeartbeat: number | null;
  status: AgentStatus | null;
  pendingCommands: number;
  lastError: string | null;
}
