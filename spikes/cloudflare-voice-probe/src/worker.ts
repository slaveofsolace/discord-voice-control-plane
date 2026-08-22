import { Container, getContainer } from "@cloudflare/containers";

import type { ProbeReport } from "./report.js";

interface Env {
  VOICE_PROBE_CONTAINER: DurableObjectNamespace<VoiceProbeContainer>;
  PROBE_ENABLED: string;
  PROBE_GUILD_ID: string;
  PROBE_VOICE_CHANNEL_ID: string;
  PROBE_STABLE_MS: string;
  DISCORD_BOT_TOKEN: string;
}

interface ProbeConfiguration {
  botToken: string;
  channelId: string;
  guildId: string;
  stableMs: string;
}

interface LifecycleEvidence {
  phase: string;
  first_run_id: string | null;
  second_run_id: string | null;
  report: ProbeReport | null;
}

export class VoiceProbeContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "5m";
  enableInternet = true;

  async prove(enabled: boolean, configuration?: ProbeConfiguration): Promise<LifecycleEvidence> {
    if (!enabled) {
      const state = await this.getState();
      if (state.status === "healthy" || state.status === "running") await this.stop("SIGTERM");
      return { phase: "DISABLED", first_run_id: null, second_run_id: null, report: null };
    }
    const verified = await this.ctx.storage.get<boolean>("lifecycle_verified");
    const firstRunId = (await this.ctx.storage.get<string>("first_run_id")) ?? null;
    if (verified) {
      return {
        phase: "LIFECYCLE_RESTART_VERIFIED",
        first_run_id: firstRunId,
        second_run_id: null,
        report: null
      };
    }
    if (configuration === undefined) throw new Error("PROBE_CONFIGURATION_REQUIRED");
    await this.startAndWaitForPorts({
      ports: 8080,
      startOptions: {
        enableInternet: true,
        envVars: {
          DISCORD_BOT_TOKEN: configuration.botToken,
          PORT: "8080",
          PROBE_GUILD_ID: configuration.guildId,
          PROBE_STABLE_MS: configuration.stableMs,
          PROBE_VOICE_CHANNEL_ID: configuration.channelId
        }
      },
      cancellationOptions: { portReadyTimeoutMS: 30_000 }
    });
    const deadline = Date.now() + 180_000;
    let report: ProbeReport | null = null;
    while (Date.now() < deadline) {
      const response = await this.containerFetch("http://localhost/report");
      report = await response.json<ProbeReport>();
      if (report.phase === "COMPLETE" || report.phase === "FAILED") break;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    if (report === null || report.phase === "RUNNING" || report.phase === "IDLE") {
      throw new Error("PROBE_RESULT_TIMEOUT");
    }
    if (report.phase === "FAILED") {
      await this.stop("SIGTERM");
      return { phase: "PROBE_FAILED", first_run_id: firstRunId, second_run_id: null, report };
    }
    if (firstRunId === null) {
      await this.ctx.storage.put("first_run_id", report.run_id);
      await this.stop("SIGTERM");
      return {
        phase: "FIRST_RUN_COMPLETE_AND_STOPPED",
        first_run_id: report.run_id,
        second_run_id: null,
        report
      };
    }
    if (firstRunId === report.run_id) throw new Error("CONTAINER_DID_NOT_RESTART");
    await this.ctx.storage.put("lifecycle_verified", true);
    await this.stop("SIGTERM");
    return {
      phase: "LIFECYCLE_RESTART_VERIFIED",
      first_run_id: firstRunId,
      second_run_id: report.run_id,
      report
    };
  }
}

export default {
  fetch(): Response {
    return new Response("Not found", { status: 404 });
  },
  scheduled(_event: ScheduledController, env: Env, context: ExecutionContext): void {
    const configuration: ProbeConfiguration = {
      botToken: env.DISCORD_BOT_TOKEN,
      channelId: env.PROBE_VOICE_CHANNEL_ID,
      guildId: env.PROBE_GUILD_ID,
      stableMs: env.PROBE_STABLE_MS
    };
    context.waitUntil(
      getContainer(env.VOICE_PROBE_CONTAINER, "cloudflare-voice-probe")
        .prove(env.PROBE_ENABLED === "true", configuration)
        .then((evidence) =>
          console.log(JSON.stringify({ event: "cloudflare_voice_probe_lifecycle", ...evidence }))
        )
    );
  }
} satisfies ExportedHandler<Env>;
