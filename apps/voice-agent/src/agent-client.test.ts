import { createServer, type Server } from "node:http";

import { WebSocketServer, type WebSocket } from "ws";
import { describe, expect, it, vi } from "vitest";

import {
  agentHandshakePayload,
  signCommandEnvelope,
  verifyAgentHandshake
} from "@discord-vc-control/security";

import { AgentClient } from "./agent-client.js";

const currentSecret = "current-agent-secret-with-at-least-32-bytes";
const previousSecret = "previous-agent-secret-with-at-least-32-bytes";

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("TEST_SERVER_ADDRESS");
      resolve(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

function requiredHeader(value: string | string[] | undefined): string {
  if (typeof value !== "string") throw new Error("MISSING_TEST_HEADER");
  return value;
}

describe("agent WebSocket client", () => {
  it("signs its upgrade and accepts current or previous-key commands idempotently", async () => {
    const server = createServer();
    const webSockets = new WebSocketServer({ noServer: true });
    let upgradeHeaders: Record<string, string | string[] | undefined> = {};
    const outboundMessages: unknown[] = [];
    const connection = new Promise<WebSocket>((resolve) => webSockets.once("connection", resolve));
    webSockets.on("connection", (socket) => {
      socket.on("message", (data) => outboundMessages.push(JSON.parse(data.toString())));
    });
    server.on("upgrade", (request, socket, head) => {
      upgradeHeaders = request.headers;
      webSockets.handleUpgrade(request, socket, head, (webSocket) => {
        webSockets.emit("connection", webSocket, request);
      });
    });
    const port = await listen(server);
    let releaseBootstrap = (): void => undefined;
    const bootstrapGate = new Promise<void>((resolve) => {
      releaseBootstrap = resolve;
    });
    const onBootstrap = vi.fn(() => bootstrapGate);
    const onBlocked = vi.fn();
    const onCommand = vi.fn();
    const client = new AgentClient({
      deploymentId: "test",
      tenantId: "test",
      endpoint: `ws://127.0.0.1:${port}/agent/ws`,
      keyId: "current-v2",
      secret: currentSecret,
      previousKeyId: "previous-v1",
      previousSecret,
      onBlocked,
      onBootstrap,
      onCommand
    });

    const queuedStatus = {
      type: "status" as const,
      deployment_id: "test",
      desired_connected: false,
      observed_state: "DISABLED" as const,
      gateway_connected: false,
      voice_connected: false,
      udp_established: false,
      dave_established: false,
      target_guild_id: null,
      target_channel_id: null,
      circuit_open: false,
      retry_count: 0,
      last_error_code: null,
      last_health_at: 1
    };
    client.send(queuedStatus);
    client.send({ ...queuedStatus, observed_state: "STARTING", last_health_at: 2 });

    await client.start();
    const socket = await connection;
    await vi.waitFor(() => expect(outboundMessages).toHaveLength(1));
    expect(outboundMessages[0]).toMatchObject({ observed_state: "STARTING", last_health_at: 2 });
    const timestamp = Number(requiredHeader(upgradeHeaders["x-agent-timestamp"]));
    const nonce = requiredHeader(upgradeHeaders["x-agent-nonce"]);
    const signature = requiredHeader(upgradeHeaders["x-agent-signature"]);
    const payload = agentHandshakePayload({
      agentId: "test",
      method: "GET",
      nonce,
      path: "/agent/ws",
      timestamp
    });
    await expect(verifyAgentHandshake(payload, signature, currentSecret)).resolves.toBe(true);
    expect(upgradeHeaders["x-agent-key-id"]).toBe("current-v2");

    socket.send(
      JSON.stringify({
        type: "bootstrap",
        deployment_id: "test",
        tenant_id: "test",
        desired_connected: false,
        paused: false,
        guild_configs: [],
        managed_rooms: [],
        authorized_target: null
      })
    );
    await vi.waitFor(() => expect(onBootstrap).toHaveBeenCalledOnce());

    const now = Date.now();
    const signed = await signCommandEnvelope(
      {
        version: 1,
        command_id: crypto.randomUUID(),
        issued_at: now,
        expires_at: now + 30_000,
        nonce: crypto.randomUUID(),
        actor_user_id: "100000000000000001",
        control_guild_id: "100000000000000002",
        control_channel_id: "100000000000000003",
        deployment_id: "test",
        tenant_id: "test",
        action: "status",
        payload: {},
        kid: "previous-v1"
      },
      previousSecret
    );
    socket.send(JSON.stringify(signed));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(onCommand).not.toHaveBeenCalled();
    releaseBootstrap();
    await vi.waitFor(() =>
      expect(outboundMessages).toContainEqual({
        type: "command_start",
        command_id: signed.command_id,
        deployment_id: "test",
        occurred_at: expect.any(Number)
      })
    );
    socket.send(
      JSON.stringify({
        type: "command_start_ack",
        command_id: signed.command_id,
        deployment_id: "test",
        accepted: true,
        duplicate: false
      })
    );
    await vi.waitFor(() => expect(onCommand).toHaveBeenCalledWith(signed, false));
    socket.send(JSON.stringify(signed));
    await vi.waitFor(() => expect(onCommand).toHaveBeenLastCalledWith(signed, true));

    client.close();
    socket.terminate();
    await new Promise<void>((resolve) => webSockets.close(() => resolve()));
    await closeServer(server);
  });

  it("rejects bootstrap state for a different tenant", async () => {
    const server = createServer();
    const webSockets = new WebSocketServer({ noServer: true });
    const connection = new Promise<WebSocket>((resolve) => webSockets.once("connection", resolve));
    server.on("upgrade", (request, socket, head) => {
      webSockets.handleUpgrade(request, socket, head, (webSocket) => {
        webSockets.emit("connection", webSocket, request);
      });
    });
    const port = await listen(server);
    const onBootstrap = vi.fn();
    const onBlocked = vi.fn();
    const client = new AgentClient({
      deploymentId: "test",
      tenantId: "test",
      endpoint: `ws://127.0.0.1:${port}/agent/ws`,
      keyId: "current-v2",
      secret: currentSecret,
      onBlocked,
      onBootstrap,
      onCommand: vi.fn()
    });
    await client.start();
    const socket = await connection;
    const closed = new Promise<number>((resolve) => socket.once("close", resolve));
    socket.send(
      JSON.stringify({
        type: "bootstrap",
        deployment_id: "test",
        tenant_id: "another-tenant",
        desired_connected: false,
        paused: false,
        guild_configs: [],
        managed_rooms: [],
        authorized_target: null
      })
    );
    await expect(closed).resolves.toBe(1008);
    expect(onBootstrap).not.toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalledWith("WRONG_BOOTSTRAP_TENANT");
    client.close();
    await new Promise<void>((resolve) => webSockets.close(() => resolve()));
    await closeServer(server);
  });

  it("rejects a validly signed command for a different tenant", async () => {
    const server = createServer();
    const webSockets = new WebSocketServer({ noServer: true });
    const connection = new Promise<WebSocket>((resolve) => webSockets.once("connection", resolve));
    server.on("upgrade", (request, socket, head) => {
      webSockets.handleUpgrade(request, socket, head, (webSocket) => {
        webSockets.emit("connection", webSocket, request);
      });
    });
    const port = await listen(server);
    const onCommand = vi.fn();
    const onBlocked = vi.fn();
    const client = new AgentClient({
      deploymentId: "test",
      tenantId: "test",
      endpoint: `ws://127.0.0.1:${port}/agent/ws`,
      keyId: "current-v2",
      secret: currentSecret,
      onBlocked,
      onBootstrap: vi.fn(),
      onCommand
    });
    await client.start();
    const socket = await connection;
    const now = Date.now();
    const signed = await signCommandEnvelope(
      {
        version: 1,
        command_id: crypto.randomUUID(),
        issued_at: now,
        expires_at: now + 30_000,
        nonce: crypto.randomUUID(),
        actor_user_id: "100000000000000001",
        control_guild_id: "100000000000000002",
        control_channel_id: "100000000000000003",
        deployment_id: "test",
        tenant_id: "another-tenant",
        action: "status",
        payload: {},
        kid: "current-v2"
      },
      currentSecret
    );
    const closed = new Promise<number>((resolve) => socket.once("close", resolve));
    socket.send(JSON.stringify(signed));
    await expect(closed).resolves.toBe(1008);
    expect(onCommand).not.toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalledWith("WRONG_COMMAND_TENANT");
    client.close();
    await new Promise<void>((resolve) => webSockets.close(() => resolve()));
    await closeServer(server);
  });

  it("blocks a rejected signed upgrade instead of reconnecting forever", async () => {
    const server = createServer();
    server.on("upgrade", (_request, socket) => {
      socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    });
    const port = await listen(server);
    let resolveBlocked: (code: string) => void = () => undefined;
    const blocked = new Promise<string>((resolve) => {
      resolveBlocked = resolve;
    });
    const client = new AgentClient({
      deploymentId: "test",
      tenantId: "test",
      endpoint: `ws://127.0.0.1:${port}/agent/ws`,
      keyId: "current-v2",
      secret: currentSecret,
      onBlocked: resolveBlocked,
      onBootstrap: vi.fn(),
      onCommand: vi.fn()
    });

    await client.start();
    await expect(blocked).resolves.toBe("AGENT_AUTH_REJECTED");
    expect(client.connected).toBe(false);
    client.close();
    await closeServer(server);
  });
});
