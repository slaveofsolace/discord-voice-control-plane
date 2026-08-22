export interface ProbeReport {
  run_id: string;
  phase: "IDLE" | "RUNNING" | "COMPLETE" | "FAILED";
  dns_resolved: boolean;
  https_reached: boolean;
  gateway_websocket_hello: boolean;
  bot_gateway_ready: boolean;
  gateway_reauthentication_completed: boolean;
  udp_socket_created: boolean;
  udp_discovery_request_sent: boolean;
  udp_discovery_response_received: boolean;
  udp_ip_discovery_completed: boolean;
  voice_connection_established: boolean;
  dave_negotiated: boolean;
  dave_renegotiated_after_voice_rejoin: boolean;
  stable_silent_connection: boolean;
  controlled_voice_rejoin_completed: boolean;
  native_stack_loaded: boolean;
  inbound_udp_listener_required: boolean;
  inbound_udp_listener_opened: boolean;
  audio_sent_or_received: boolean;
  sigterm_handler_ready: boolean;
  sigterm_received: boolean;
  clean_shutdown_completed: boolean;
  udp_evidence_basis: "VOICE_READY_PROTOCOL_PRECONDITION" | null;
  error_code: string | null;
  completed_at: number | null;
}

export const requiredConnectivityGates = [
  "dns_resolved",
  "https_reached",
  "gateway_websocket_hello",
  "bot_gateway_ready",
  "gateway_reauthentication_completed",
  "udp_socket_created",
  "udp_discovery_request_sent",
  "udp_discovery_response_received",
  "udp_ip_discovery_completed",
  "voice_connection_established",
  "dave_negotiated",
  "dave_renegotiated_after_voice_rejoin",
  "stable_silent_connection",
  "controlled_voice_rejoin_completed",
  "native_stack_loaded",
  "sigterm_handler_ready"
] as const satisfies readonly (keyof ProbeReport)[];

export function missingConnectivityGates(report: ProbeReport): string[] {
  const missing: string[] = requiredConnectivityGates.filter((gate) => !report[gate]);
  if (report.udp_evidence_basis !== "VOICE_READY_PROTOCOL_PRECONDITION") {
    missing.push("udp_evidence_basis");
  }
  if (report.inbound_udp_listener_required) {
    missing.push("inbound_udp_listener_required_false");
  }
  if (report.inbound_udp_listener_opened) {
    missing.push("inbound_udp_listener_opened_false");
  }
  if (report.audio_sent_or_received) missing.push("audio_sent_or_received_false");
  return missing;
}
