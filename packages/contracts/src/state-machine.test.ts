import { describe, expect, it } from "vitest";

import { retryDelayMs, transitionVoiceMachine, type VoiceMachineSnapshot } from "./index.js";

const disabled: VoiceMachineSnapshot = {
  state: "DISABLED",
  desiredConnected: false,
  retryCount: 0,
  circuitOpen: false,
  reason: "initial"
};

describe("voice state machine", () => {
  it("connects only after an explicit request", () => {
    const connecting = transitionVoiceMachine(disabled, { type: "CONNECT_REQUEST" });
    expect(connecting).toMatchObject({
      state: "CONNECTING",
      desiredConnected: true,
      circuitOpen: false
    });
    expect(transitionVoiceMachine(connecting, { type: "CONNECTED" }).state).toBe("CONNECTED");
  });

  it("backs off only for a desired transient connection", () => {
    const connected = transitionVoiceMachine(disabled, { type: "CONNECT_REQUEST" });
    const backingOff = transitionVoiceMachine(connected, {
      type: "TRANSIENT_DISCONNECT",
      reason: "udp_timeout"
    });
    expect(backingOff).toMatchObject({ state: "BACKING_OFF", retryCount: 1 });
    expect(transitionVoiceMachine(backingOff, { type: "RETRY_TIMER" }).state).toBe("CONNECTING");
    expect(
      transitionVoiceMachine(disabled, { type: "TRANSIENT_DISCONNECT", reason: "ignored" })
    ).toEqual(disabled);
  });

  it("reports DAVE negotiation as degraded until the encrypted session is ready", () => {
    const connecting = transitionVoiceMachine(disabled, { type: "CONNECT_REQUEST" });
    const degraded = transitionVoiceMachine(connecting, { type: "DAVE_PENDING" });
    expect(degraded).toMatchObject({ state: "DEGRADED", desiredConnected: true });
    expect(transitionVoiceMachine(degraded, { type: "CONNECTED" })).toMatchObject({
      state: "CONNECTED",
      desiredConnected: true
    });
  });

  it.each([
    "MODERATOR_DISCONNECT",
    "MODERATOR_MOVE",
    "PERMISSION_LOST",
    "CHANNEL_DELETED",
    "AUTH_FAILURE",
    "PROTOCOL_FAILURE",
    "MAX_RETRIES"
  ] as const)("opens the circuit for %s", (type) => {
    const connected = { ...disabled, state: "CONNECTED" as const, desiredConnected: true };
    expect(transitionVoiceMachine(connected, { type })).toMatchObject({
      state: "BLOCKED",
      desiredConnected: false,
      circuitOpen: true
    });
  });

  it("does not reconnect after leave or while paused", () => {
    const connected = { ...disabled, state: "CONNECTED" as const, desiredConnected: true };
    const left = transitionVoiceMachine(connected, { type: "LEAVE" });
    const paused = transitionVoiceMachine(connected, { type: "PAUSE" });
    expect(left).toMatchObject({ state: "DISABLED", desiredConnected: false });
    expect(paused).toMatchObject({ state: "PAUSED", desiredConnected: true });
    expect(
      transitionVoiceMachine(paused, { type: "TRANSIENT_DISCONNECT", reason: "ignored" })
    ).toEqual(paused);
  });

  it("caps exponential retry delay and adds bounded jitter", () => {
    expect(retryDelayMs(1, 0)).toBe(1000);
    expect(retryDelayMs(2, 1)).toBe(2500);
    expect(retryDelayMs(20, 1)).toBe(37_500);
  });
});
