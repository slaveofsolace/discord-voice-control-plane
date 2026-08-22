/* eslint-disable security/detect-non-literal-fs-filename -- all paths are resolved beneath the protected profile secret root */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, open, readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";

import { type RelayRequest } from "@discord-vc-control/contracts";

import { type UserRpcController } from "./user-rpc-controller.js";

interface DashboardSession {
  csrf: string;
  expiresAt: number;
}

const maxBodyBytes = 16 * 1024;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function equalSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  if (leftBytes.byteLength !== rightBytes.byteLength) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const declared = Number(request.headers["content-length"] ?? "0");
  if (Number.isFinite(declared) && declared > maxBodyBytes)
    throw new Error("DASHBOARD_BODY_TOO_LARGE");
  const decoder = new StringDecoder("utf8");
  let body = "";
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > maxBodyBytes) throw new Error("DASHBOARD_BODY_TOO_LARGE");
    body += decoder.write(bytes);
  }
  return body + decoder.end();
}

function cookieValue(request: IncomingMessage, name: string): string | null {
  const cookie = request.headers.cookie ?? "";
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

function page(response: ServerResponse, status: number, body: string, nonce = ""): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-security-policy": `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
    "content-type": "text/html; charset=utf-8",
    "cross-origin-opener-policy": "same-origin",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY"
  });
  response.end(body);
}

function shell(nonce: string, title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style nonce="${nonce}">
  :root{color-scheme:dark;background:#111;color:#eee;font:14px/1.45 system-ui,sans-serif}body{margin:0 auto;max-width:1180px;padding:22px}h1{font-size:22px;margin:0 0 6px}p{margin:4px 0 14px}.muted{color:#aaa}.queue{display:grid;gap:10px}.request{border:1px solid #444;padding:12px;background:#181818}.meta{display:flex;flex-wrap:wrap;gap:6px 16px;font-family:ui-monospace,monospace;font-size:12px}.preview{white-space:pre-wrap;overflow-wrap:anywhere;border-left:3px solid #666;padding:8px 10px;margin:10px 0;background:#0d0d0d}.risk{color:#ffd166;font-weight:800}.elevated{border-color:#b77700}.actions{display:flex;flex-wrap:wrap;gap:7px}.actions form{margin:0}button{background:#eee;color:#111;border:0;padding:7px 10px;font-weight:650;cursor:pointer}button.danger{background:#b83b3b;color:#fff}input{box-sizing:border-box;max-width:540px;width:100%;padding:8px;background:#080808;color:#fff;border:1px solid #666}</style></head><body>${body}</body></html>`;
}

function actionForm(
  csrf: string,
  requestId: string,
  action: string,
  label: string,
  danger = false
): string {
  return `<form method="post" action="/requests/${requestId}/${action}"><input type="hidden" name="csrf" value="${csrf}"><button${danger ? ' class="danger"' : ""} type="submit">${escapeHtml(label)}</button></form>`;
}

function requestHtml(request: RelayRequest, csrf: string, now: number): string {
  const elevated = request.risk === "ELEVATED";
  const command =
    request.parsed_command === null
      ? "ordinary chat"
      : `!voice ${request.parsed_command.name}${request.parsed_command.argument === undefined ? "" : ` ${request.parsed_command.argument}`}${request.parsed_command.user_id === undefined ? "" : ` ${request.parsed_command.user_id}`}`;
  const actions: string[] = [];
  if (request.status === "PENDING_USER_APPROVAL" || request.status === "RECEIVED") {
    actions.push(actionForm(csrf, request.request_id, "prepare", "Prepare in Discord"));
    actions.push(actionForm(csrf, request.request_id, "reject", "Reject", true));
    actions.push(actionForm(csrf, request.request_id, "expire", "Expire"));
  }
  if (request.status === "PREPARED_FOR_MANUAL_SEND") {
    actions.push(actionForm(csrf, request.request_id, "sent", "Mark sent"));
    actions.push(actionForm(csrf, request.request_id, "not-sent", "Not sent"));
    actions.push(actionForm(csrf, request.request_id, "reject", "Reject", true));
  }
  return `<article class="request${elevated ? " elevated" : ""}">${elevated ? '<div class="risk">ELEVATED RISK — verify the member and operation before preparing.</div>' : ""}<div class="meta"><span>request ${request.request_id}</span><span>sender ${request.actor_user_id}</span><span>target ${request.target_guild_id}/${request.target_text_channel_id}</span><span>voice ${request.target_voice_channel_id}</span><span>age ${Math.max(0, Math.floor((now - request.created_at) / 1000))}s</span><span>expires ${new Date(request.expires_at).toISOString()}</span><span>state ${request.status}</span><span>parsed ${escapeHtml(command)}</span></div><div class="preview">${request.content === null ? "[content purged]" : escapeHtml(request.content)}</div><div class="actions">${actions.join("")}</div></article>`;
}

export async function ensureDashboardSecret(
  secretRoot: string,
  profileName: string
): Promise<{ path: string; secret: string }> {
  const path = resolve(secretRoot, `${profileName}.dashboard.key`);
  try {
    const secret = (await readFile(path, "utf8")).trim();
    if (secret.length < 43) throw new Error("DASHBOARD_SECRET_INVALID");
    return { path, secret };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const secret = randomBytes(32).toString("base64url");
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(`${secret}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(path, 0o600).catch(() => undefined);
  return { path, secret };
}

export class LocalRelayDashboard {
  readonly #sessions = new Map<string, DashboardSession>();
  #server: Server | null = null;

  constructor(
    private readonly options: {
      controller: Pick<
        UserRpcController,
        | "expireRelay"
        | "listRelayRequests"
        | "markRelayNotSent"
        | "markRelaySent"
        | "prepareRelay"
        | "rejectRelay"
      >;
      port: number;
      secret: string;
    }
  ) {}

  async start(): Promise<void> {
    if (this.#server !== null) return;
    this.#server = createServer((request, response) => {
      void this.handle(request, response).catch((error: unknown) => {
        const code = error instanceof Error ? error.message : "DASHBOARD_FAILED";
        page(response, code === "DASHBOARD_BODY_TOO_LARGE" ? 413 : 400, "Request rejected.");
      });
    });
    await new Promise<void>((resolveStart, rejectStart) => {
      this.#server?.once("error", rejectStart);
      this.#server?.listen(this.options.port, "127.0.0.1", resolveStart);
    });
  }

  async close(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    if (server === null) return;
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const expectedHost = `127.0.0.1:${this.options.port}`;
    if (request.headers.host !== expectedHost) {
      response.writeHead(421).end("Misdirected request");
      return;
    }
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", `http://${expectedHost}`);
    if (url.pathname === "/healthz" && method === "GET") {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        "x-content-type-options": "nosniff"
      });
      response.end('{"ok":true}');
      return;
    }
    if (method === "POST" && request.headers.origin !== `http://${expectedHost}`) {
      response.writeHead(403).end("Origin rejected");
      return;
    }
    if (url.pathname === "/session" && method === "POST") {
      const form = new URLSearchParams(await readBody(request));
      if (!equalSecret(form.get("secret") ?? "", this.options.secret)) {
        page(response, 401, "Authentication failed.");
        return;
      }
      const sessionId = randomBytes(32).toString("base64url");
      this.#sessions.set(sessionId, {
        csrf: randomBytes(24).toString("base64url"),
        expiresAt: Date.now() + 8 * 60 * 60_000
      });
      response.writeHead(303, {
        "cache-control": "no-store",
        location: "/",
        "set-cookie": `relay_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`
      });
      response.end();
      return;
    }
    const sessionId = cookieValue(request, "relay_session");
    const session = sessionId === null ? undefined : this.#sessions.get(sessionId);
    if (session !== undefined && session.expiresAt <= Date.now()) {
      this.#sessions.delete(sessionId ?? "");
    }
    const activeSession = session !== undefined && session.expiresAt > Date.now() ? session : null;
    if (activeSession === null) {
      if (method !== "GET" || url.pathname !== "/") {
        response.writeHead(401).end("Authentication required");
        return;
      }
      const nonce = randomBytes(18).toString("base64url");
      page(
        response,
        200,
        shell(
          nonce,
          "Relay queue sign-in",
          `<h1>Relay queue</h1><p>Enter the profile-bound dashboard secret stored in the protected local runtime directory.</p><form method="post" action="/session"><input type="password" name="secret" autocomplete="current-password" required><button type="submit">Open queue</button></form>`
        ),
        nonce
      );
      return;
    }
    if (method === "POST") {
      const form = new URLSearchParams(await readBody(request));
      if (!equalSecret(form.get("csrf") ?? "", activeSession.csrf)) {
        response.writeHead(403).end("CSRF rejected");
        return;
      }
      const match = /^\/requests\/([a-f\d-]{36})\/(prepare|reject|expire|sent|not-sent)$/iu.exec(
        url.pathname
      );
      if (match?.[1] === undefined || match[2] === undefined) {
        response.writeHead(404).end("Not found");
        return;
      }
      const [requestId, action] = [match[1], match[2]];
      if (action === "prepare") await this.options.controller.prepareRelay(requestId);
      else if (action === "reject") await this.options.controller.rejectRelay(requestId);
      else if (action === "expire") await this.options.controller.expireRelay(requestId);
      else if (action === "sent") await this.options.controller.markRelaySent(requestId);
      else await this.options.controller.markRelayNotSent(requestId);
      response.writeHead(303, { "cache-control": "no-store", location: "/" }).end();
      return;
    }
    if (method !== "GET" || url.pathname !== "/") {
      response.writeHead(404).end("Not found");
      return;
    }
    const requests = await this.options.controller.listRelayRequests();
    const nonce = randomBytes(18).toString("base64url");
    const body = `<h1>Local relay approval queue</h1><p class="muted">Preparing selects the exact authorized text channel and copies the draft. Discord paste and Send remain manual.</p><section class="queue">${requests.length === 0 ? "<p>No relay requests.</p>" : requests.map((item) => requestHtml(item, activeSession.csrf, Date.now())).join("")}</section>`;
    page(response, 200, shell(nonce, "Local relay approval queue", body), nonce);
  }
}
