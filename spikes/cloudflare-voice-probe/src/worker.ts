import { Container, getContainer, type StopParams } from "@cloudflare/containers";

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
  first_report: ProbeReport | null;
  second_report: ProbeReport | null;
  first_stop: StopEvidence | null;
  second_stop: StopEvidence | null;
  report: ProbeReport | null;
}

interface StopEvidence {
  run_id: string;
  requested_signal: "SIGTERM";
  exit_code: number;
  reason: string;
  clean_exit: boolean;
  observed_at: number;
}

export class VoiceProbeContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "5m";
  enableInternet = true;

  async prove(enabled: boolean, configuration?: ProbeConfiguration): Promise<LifecycleEvidence> {
    if (!enabled) {
      const state = await this.getState();
      if (state.status === "healthy" || state.status === "running") await this.stop("SIGTERM");
      return this.lifecycleEvidence("DISABLED", null);
    }
    const verified = await this.ctx.storage.get<boolean>("lifecycle_verified");
    const firstRunId = (await this.ctx.storage.get<string>("first_run_id")) ?? null;
    const secondRunId = (await this.ctx.storage.get<string>("second_run_id")) ?? null;
    const firstStop = (await this.ctx.storage.get<StopEvidence>("first_stop")) ?? null;
    const secondStop = (await this.ctx.storage.get<StopEvidence>("second_stop")) ?? null;
    if (verified) {
      return this.lifecycleEvidence("LIFECYCLE_RESTART_VERIFIED", null);
    }
    if (firstStop !== null && !firstStop.clean_exit) {
      return this.lifecycleEvidence("FIRST_SIGTERM_NOT_CLEAN", null);
    }
    if (secondStop !== null && !secondStop.clean_exit) {
      return this.lifecycleEvidence("SECOND_SIGTERM_NOT_CLEAN", null);
    }
    if (secondRunId !== null) {
      if (firstStop?.clean_exit === true && secondStop?.clean_exit === true) {
        await this.ctx.storage.put("lifecycle_verified", true);
        return this.lifecycleEvidence("LIFECYCLE_RESTART_VERIFIED", null);
      }
      return this.lifecycleEvidence("WAITING_FOR_SIGTERM_EVIDENCE", null);
    }
    if (firstRunId !== null && firstStop === null) {
      return this.lifecycleEvidence("WAITING_FOR_SIGTERM_EVIDENCE", null);
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
    this.renewActivityTimeout();
    const deadline = Date.now() + 180_000;
    let report: ProbeReport | null = null;
    while (Date.now() < deadline) {
      const response = await this.containerFetch("http://localhost/report");
      report = await response.json<ProbeReport>();
      if (report.phase === "COMPLETE" || report.phase === "FAILED") break;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    if (report === null || report.phase === "RUNNING" || report.phase === "IDLE") {
      await this.stop("SIGTERM");
      throw new Error("PROBE_RESULT_TIMEOUT");
    }
    if (report.phase === "FAILED") {
      await this.stop("SIGTERM");
      return this.lifecycleEvidence("PROBE_FAILED", report);
    }
    if (firstRunId === null) {
      await this.ctx.storage.put({
        first_run_id: report.run_id,
        first_report: report,
        pending_stop_run_id: report.run_id
      });
      await this.stop("SIGTERM");
      return this.lifecycleEvidence("FIRST_RUN_COMPLETE_AND_STOPPED", report);
    }
    if (firstRunId === report.run_id) {
      await this.stop("SIGTERM");
      throw new Error("CONTAINER_DID_NOT_RESTART");
    }
    await this.ctx.storage.put({
      second_run_id: report.run_id,
      second_report: report,
      pending_stop_run_id: report.run_id
    });
    await this.stop("SIGTERM");
    return this.lifecycleEvidence("SECOND_RUN_COMPLETE_AND_STOPPED", report);
  }

  override onStop({ exitCode, reason }: StopParams): void {
    this.ctx.waitUntil(
      (async () => {
        const runId = await this.ctx.storage.get<string>("pending_stop_run_id");
        if (runId === undefined) return;
        const firstRunId = await this.ctx.storage.get<string>("first_run_id");
        const evidence: StopEvidence = {
          run_id: runId,
          requested_signal: "SIGTERM",
          exit_code: exitCode,
          reason,
          clean_exit: exitCode === 0,
          observed_at: Date.now()
        };
        await this.ctx.storage.put(runId === firstRunId ? "first_stop" : "second_stop", evidence);
        await this.ctx.storage.delete("pending_stop_run_id");
      })()
    );
  }

  private async lifecycleEvidence(
    phase: string,
    report: ProbeReport | null
  ): Promise<LifecycleEvidence> {
    const [firstRunId, secondRunId, firstReport, secondReport, firstStop, secondStop] =
      await Promise.all([
        this.ctx.storage.get<string>("first_run_id"),
        this.ctx.storage.get<string>("second_run_id"),
        this.ctx.storage.get<ProbeReport>("first_report"),
        this.ctx.storage.get<ProbeReport>("second_report"),
        this.ctx.storage.get<StopEvidence>("first_stop"),
        this.ctx.storage.get<StopEvidence>("second_stop")
      ]);
    return {
      phase,
      first_run_id: firstRunId ?? null,
      second_run_id: secondRunId ?? null,
      first_report: firstReport ?? null,
      second_report: secondReport ?? null,
      first_stop: firstStop ?? null,
      second_stop: secondStop ?? null,
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
