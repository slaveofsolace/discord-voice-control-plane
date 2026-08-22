import { describe, expect, it } from "vitest";

import { missingConnectivityGates, requiredConnectivityGates, type ProbeReport } from "./report.js";

describe("Cloudflare voice probe evidence gates", () => {
  it("fails closed when any required connectivity fact is absent", () => {
    const report = Object.fromEntries(
      requiredConnectivityGates.map((gate) => [gate, true])
    ) as unknown as ProbeReport;
    report.udp_evidence_basis = "VOICE_READY_PROTOCOL_PRECONDITION";
    report.inbound_udp_listener_required = false;
    report.inbound_udp_listener_opened = false;
    report.audio_sent_or_received = false;
    expect(missingConnectivityGates(report)).toEqual([]);
    report.https_reached = false;
    report.dave_renegotiated_after_voice_rejoin = false;
    expect(missingConnectivityGates(report)).toEqual([
      "https_reached",
      "dave_renegotiated_after_voice_rejoin"
    ]);
  });
});
