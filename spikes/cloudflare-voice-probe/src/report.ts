export interface ProbeReport {
  run_id: string;
  phase: "IDLE" | "RUNNING" | "COMPLETE" | "FAILED";
  dns_resolved: boolean;
  https_reached: boolean;
  gateway_websocket_hello: boolean;
  bot_gateway_ready: boolean;
  udp_ip_discovery_completed: boolean;
  dave_negotiated: boolean;
  stable_silent_connection: boolean;
  disconnect_recovery: boolean;
  native_stack_loaded: boolean;
  inbound_udp_listener_required: false;
  error_code: string | null;
  completed_at: number | null;
}
