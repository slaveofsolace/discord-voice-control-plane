import { afterEach, describe, expect, it, vi } from "vitest";
import { request as httpRequest } from "node:http";

import { type RelayRequest } from "@discord-vc-control/contracts";

import { LocalRelayDashboard } from "./dashboard.js";

const dashboards: LocalRelayDashboard[] = [];

afterEach(async () => {
  await Promise.all(dashboards.splice(0).map((dashboard) => dashboard.close()));
});

function queuedRequest(): RelayRequest {
  return {
    request_id: "00000000-0000-5000-8000-000000000001",
    command_id: "00000000-0000-5000-8000-000000000001",
    deployment_id: "test",
    tenant_id: "test",
    profile_name: "main",
    source_application_id: "100000000000000001",
    source_message_id: "100000000000000002",
    actor_user_id: "100000000000000003",
    actor_role_ids: [],
    control_guild_id: "100000000000000004",
    control_channel_id: "100000000000000005",
    target_guild_id: "100000000000000006",
    target_voice_channel_id: "100000000000000007",
    target_text_channel_id: "100000000000000008",
    content_kind: "voice_command",
    risk: "ELEVATED",
    parsed_command: { name: "ban", user_id: "100000000000000009" },
    content: "!voice ban 100000000000000009",
    status: "PENDING_USER_APPROVAL",
    result_code: "PENDING_USER_APPROVAL",
    created_at: Date.now(),
    updated_at: Date.now(),
    expires_at: Date.now() + 30 * 60_000
  };
}

async function harness() {
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const controller = {
    expireRelay: vi.fn(),
    listRelayRequests: vi.fn().mockResolvedValue([queuedRequest()]),
    markRelayNotSent: vi.fn(),
    markRelaySent: vi.fn(),
    prepareRelay: vi.fn(),
    rejectRelay: vi.fn()
  };
  const dashboard = new LocalRelayDashboard({
    controller,
    port,
    secret: "dashboard-secret-with-at-least-forty-three-characters"
  });
  dashboards.push(dashboard);
  await dashboard.start();
  return { controller, origin: `http://127.0.0.1:${port}` };
}

async function login(origin: string): Promise<{ cookie: string; csrf: string }> {
  const response = await fetch(`${origin}/session`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin
    },
    body: new URLSearchParams({
      secret: "dashboard-secret-with-at-least-forty-three-characters"
    }),
    redirect: "manual"
  });
  expect(response.status).toBe(303);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
  const queue = await fetch(`${origin}/`, { headers: { cookie } });
  const html = await queue.text();
  const csrf = /name="csrf" value="([^"]+)"/u.exec(html)?.[1] ?? "";
  expect(csrf.length).toBeGreaterThan(20);
  return { cookie, csrf };
}

async function requestWithHost(origin: string, host: string): Promise<number> {
  const url = new URL(origin);
  return new Promise<number>((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: url.hostname,
        port: Number(url.port),
        path: "/",
        method: "GET",
        headers: { host }
      },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode ?? 0));
      }
    );
    request.once("error", reject);
    request.end();
  });
}

describe("loopback relay dashboard", () => {
  it("keeps health minimal and rejects the wrong Host or Origin", async () => {
    const { origin } = await harness();
    await expect((await fetch(`${origin}/healthz`)).json()).resolves.toEqual({ ok: true });
    await expect(requestWithHost(origin, "example.test")).resolves.toBe(421);
    const wrongOrigin = await fetch(`${origin}/session`, {
      method: "POST",
      headers: { origin: "https://example.test" },
      body: "secret=x"
    });
    expect(wrongOrigin.status).toBe(403);
  });

  it("requires the profile secret, a SameSite session, and CSRF for mutation", async () => {
    const { controller, origin } = await harness();
    const denied = await fetch(`${origin}/session`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin },
      body: "secret=wrong",
      redirect: "manual"
    });
    expect(denied.status).toBe(401);
    const { cookie, csrf } = await login(origin);
    expect(cookie).toContain("relay_session=");
    const noCsrf = await fetch(`${origin}/requests/00000000-0000-5000-8000-000000000001/prepare`, {
      method: "POST",
      headers: { cookie, origin },
      body: "csrf=wrong",
      redirect: "manual"
    });
    expect(noCsrf.status).toBe(403);
    const prepared = await fetch(
      `${origin}/requests/00000000-0000-5000-8000-000000000001/prepare`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie, origin },
        body: new URLSearchParams({ csrf }),
        redirect: "manual"
      }
    );
    expect(prepared.status).toBe(303);
    expect(controller.prepareRelay).toHaveBeenCalledWith("00000000-0000-5000-8000-000000000001");
  });

  it("sets a closed CSP, uses no CORS, and labels elevated content", async () => {
    const { origin } = await harness();
    const { cookie } = await login(origin);
    const response = await fetch(`${origin}/`, { headers: { cookie } });
    const html = await response.text();
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(html).toContain("ELEVATED RISK");
    expect(html).toContain("Prepare in Discord");
    expect(html).toContain("Discord paste and Send remain manual");
  });

  it("rejects oversized form bodies", async () => {
    const { origin } = await harness();
    const response = await fetch(`${origin}/session`, {
      method: "POST",
      headers: { origin },
      body: "x".repeat(16 * 1024 + 1)
    });
    expect(response.status).toBe(413);
  });
});
