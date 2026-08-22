import { Container, getContainer, type StopParams } from "@cloudflare/containers";

interface Env {
  VOICE_AGENT_CONTAINER: DurableObjectNamespace<VoiceAgentContainer>;
  DEPLOYMENT_ID: string;
  TENANT_ID: string;
  HOST_ENABLED: string;
  PREFIX_COMMANDS_ENABLED: string;
  MESSAGE_CONTENT_INTENT_ENABLED: string;
  MANAGED_ROOMS_ENABLED: string;
  TARGET_APPROVER_USER_IDS: string;
  AGENT_KEY_ID: string;
  AGENT_PREVIOUS_KEY_ID?: string;
  DISCORD_BOT_TOKEN: string;
  CONTROL_AGENT_WS_URL: string;
  AGENT_AUTH_SECRET: string;
  AGENT_PREVIOUS_AUTH_SECRET?: string;
}

interface AgentStartConfiguration {
  agentAuthSecret: string;
  agentEndpoint: string;
  agentKeyId: string;
  agentPreviousAuthSecret?: string;
  agentPreviousKeyId?: string;
  botToken: string;
  deploymentId: string;
  managedRoomsEnabled: string;
  messageContentIntentEnabled: string;
  prefixCommandsEnabled: string;
  targetApproverUserIds: string;
  tenantId: string;
}

interface ReconcileResult {
  enabled: boolean;
  observedState: string;
  state: string;
}

export class VoiceAgentContainer extends Container<Env> {
  defaultPort = 8080;
  requiredPorts = [8080];
  sleepAfter = "2m";
  enableInternet = true;

  async reconcile(
    enabled: boolean,
    configuration?: AgentStartConfiguration
  ): Promise<ReconcileResult> {
    const state = await this.getState();
    if (!enabled) {
      if (state.status === "healthy" || state.status === "running") await this.stop("SIGTERM");
      return { enabled: false, state: (await this.getState()).status, observedState: "DISABLED" };
    }
    if (configuration === undefined) throw new Error("START_CONFIGURATION_REQUIRED");
    const envVars: Record<string, string> = {
      AGENT_AUTH_SECRET: configuration.agentAuthSecret,
      AGENT_ENDPOINT: configuration.agentEndpoint,
      AGENT_KEY_ID: configuration.agentKeyId,
      DEPLOYMENT_ID: configuration.deploymentId,
      DISCORD_BOT_TOKEN: configuration.botToken,
      MANAGED_ROOMS_ENABLED: configuration.managedRoomsEnabled,
      MESSAGE_CONTENT_INTENT_ENABLED: configuration.messageContentIntentEnabled,
      PORT: "8080",
      PREFIX_COMMANDS_ENABLED: configuration.prefixCommandsEnabled,
      TARGET_APPROVER_USER_IDS: configuration.targetApproverUserIds,
      TENANT_ID: configuration.tenantId
    };
    if (configuration.agentPreviousAuthSecret !== undefined) {
      envVars.AGENT_PREVIOUS_AUTH_SECRET = configuration.agentPreviousAuthSecret;
    }
    if (configuration.agentPreviousKeyId !== undefined) {
      envVars.AGENT_PREVIOUS_KEY_ID = configuration.agentPreviousKeyId;
    }
    await this.startAndWaitForPorts({
      ports: 8080,
      startOptions: { enableInternet: true, envVars },
      cancellationOptions: {
        instanceGetTimeoutMS: 8_000,
        portReadyTimeoutMS: 30_000,
        waitInterval: 300
      }
    });
    this.renewActivityTimeout();
    const health = await this.containerFetch("http://localhost/healthz");
    if (!health.ok) {
      await this.stop("SIGTERM");
      throw new Error(`VOICE_AGENT_HEALTH_${health.status}`);
    }
    const report = await health.json<{ status?: { observed_state?: unknown } }>();
    const observedState =
      typeof report.status?.observed_state === "string" ? report.status.observed_state : "UNKNOWN";
    return { enabled: true, state: (await this.getState()).status, observedState };
  }

  override onStop({ exitCode, reason }: StopParams): void {
    console.log(
      JSON.stringify({
        level: "info",
        event: "voice_agent_container_stopped",
        exit_code: exitCode,
        reason,
        at: new Date().toISOString()
      })
    );
  }

  override onError(error: unknown): never {
    const code = error instanceof Error ? error.message.slice(0, 120) : "CONTAINER_ERROR";
    console.error(
      JSON.stringify({
        level: "error",
        event: "voice_agent_container_error",
        code,
        at: new Date().toISOString()
      })
    );
    throw error;
  }
}

function startupConfiguration(env: Env): AgentStartConfiguration {
  return {
    agentAuthSecret: env.AGENT_AUTH_SECRET,
    agentEndpoint: env.CONTROL_AGENT_WS_URL,
    agentKeyId: env.AGENT_KEY_ID,
    botToken: env.DISCORD_BOT_TOKEN,
    deploymentId: env.DEPLOYMENT_ID,
    managedRoomsEnabled: env.MANAGED_ROOMS_ENABLED,
    messageContentIntentEnabled: env.MESSAGE_CONTENT_INTENT_ENABLED,
    prefixCommandsEnabled: env.PREFIX_COMMANDS_ENABLED,
    targetApproverUserIds: env.TARGET_APPROVER_USER_IDS,
    tenantId: env.TENANT_ID,
    ...(env.AGENT_PREVIOUS_AUTH_SECRET === undefined
      ? {}
      : { agentPreviousAuthSecret: env.AGENT_PREVIOUS_AUTH_SECRET }),
    ...(env.AGENT_PREVIOUS_KEY_ID === undefined
      ? {}
      : { agentPreviousKeyId: env.AGENT_PREVIOUS_KEY_ID })
  };
}

export default {
  fetch(): Response {
    return new Response("Not found", { status: 404 });
  },

  scheduled(_event: ScheduledController, env: Env, context: ExecutionContext): void {
    context.waitUntil(
      getContainer(env.VOICE_AGENT_CONTAINER, env.DEPLOYMENT_ID)
        .reconcile(env.HOST_ENABLED === "true", startupConfiguration(env))
        .then((result) => {
          console.log(
            JSON.stringify({
              level: "info",
              event: "voice_host_reconciled",
              deployment_id: env.DEPLOYMENT_ID,
              result,
              at: new Date().toISOString()
            })
          );
        })
    );
  }
} satisfies ExportedHandler<Env>;
