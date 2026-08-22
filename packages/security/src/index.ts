import {
  commandEnvelopeSchema,
  type CommandEnvelope,
  type UnsignedCommandEnvelope
} from "@discord-vc-control/contracts";

const encoder = new TextEncoder();
const forbiddenControls = /[\u0000-\u001F\u007F-\u009F]/u;
const bidiControls = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite numbers are not canonical JSON");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  throw new TypeError(`Unsupported canonical JSON type: ${typeof value}`);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function signCommandEnvelope(
  envelope: UnsignedCommandEnvelope,
  secret: string
): Promise<CommandEnvelope> {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(canonicalJson(envelope)));
  return commandEnvelopeSchema.parse({ ...envelope, mac: toBase64Url(new Uint8Array(signature)) });
}

export interface VerifyEnvelopeOptions {
  nowMs?: number;
  allowedClockSkewMs?: number;
  secretsByKeyId: ReadonlyMap<string, string>;
}

export async function verifyCommandEnvelope(
  input: unknown,
  options: VerifyEnvelopeOptions
): Promise<CommandEnvelope> {
  const envelope = commandEnvelopeSchema.parse(input);
  const now = options.nowMs ?? Date.now();
  const skew = options.allowedClockSkewMs ?? 5_000;
  if (envelope.issued_at > now + skew) throw new Error("COMMAND_FROM_FUTURE");
  if (envelope.expires_at < now - skew) throw new Error("COMMAND_EXPIRED");
  const secret = options.secretsByKeyId.get(envelope.kid);
  if (secret === undefined) throw new Error("UNKNOWN_KEY_ID");
  const { mac, ...unsigned } = envelope;
  const key = await importHmacKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    fromBase64Url(mac),
    encoder.encode(canonicalJson(unsigned))
  );
  if (!valid) throw new Error("INVALID_COMMAND_MAC");
  return envelope;
}

export function agentHandshakePayload(input: {
  agentId: string;
  method: string;
  nonce: string;
  path: string;
  timestamp: number;
}): string {
  return [input.method.toUpperCase(), input.path, input.agentId, input.timestamp, input.nonce].join(
    "\n"
  );
}

export async function signAgentHandshake(payload: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return toBase64Url(new Uint8Array(signature));
}

export async function verifyAgentHandshake(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    const key = await importHmacKey(secret);
    return await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(signature),
      encoder.encode(payload)
    );
  } catch {
    return false;
  }
}

export class ReplayGuard {
  readonly #seen = new Map<string, number>();

  constructor(private readonly ttlMs = 300_000) {}

  accept(nonce: string, nowMs = Date.now()): boolean {
    this.prune(nowMs);
    if (this.#seen.has(nonce)) return false;
    this.#seen.set(nonce, nowMs + this.ttlMs);
    return true;
  }

  prune(nowMs = Date.now()): void {
    for (const [nonce, expiresAt] of this.#seen) {
      if (expiresAt <= nowMs) this.#seen.delete(nonce);
    }
  }
}

export interface SanitizeRelayOptions {
  maxLength?: number;
  rejectedPrefixes?: readonly string[];
}

export function sanitizeRelayText(text: string, options: SanitizeRelayOptions = {}): string {
  const normalized = text.normalize("NFC").trim();
  const maxLength = Math.min(2000, options.maxLength ?? 1000);
  if (normalized.length === 0) throw new Error("RELAY_EMPTY");
  if (normalized.length > maxLength) throw new Error("RELAY_TOO_LONG");
  if (forbiddenControls.test(normalized) || bidiControls.test(normalized)) {
    throw new Error("RELAY_CONTROL_CHARACTER");
  }
  const prefixes = ["/", ...(options.rejectedPrefixes ?? [])];
  const lowered = normalized.toLowerCase();
  if (prefixes.some((prefix) => prefix.length > 0 && lowered.startsWith(prefix.toLowerCase()))) {
    throw new Error("RELAY_COMMAND_TEXT_REJECTED");
  }
  return normalized;
}

export function redactSecrets(value: string, secrets: readonly string[] = []): string {
  let redacted = value
    .replace(/(authorization|token|secret|signature|mac)\s*[:=]\s*[^\s,;]+/giu, "$1=[REDACTED]")
    .replace(/[A-Za-z\d_-]{24}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{20,}/gu, "[REDACTED_TOKEN]");
  for (const secret of secrets) {
    if (secret.length >= 8) redacted = redacted.replaceAll(secret, "[REDACTED]");
  }
  return redacted;
}

interface Bucket {
  count: number;
  windowStart: number;
}

export class FixedWindowRateLimiter {
  readonly #buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  consume(key: string, nowMs = Date.now()): boolean {
    const existing = this.#buckets.get(key);
    if (existing === undefined || nowMs - existing.windowStart >= this.windowMs) {
      this.#buckets.set(key, { count: 1, windowStart: nowMs });
      return true;
    }
    if (existing.count >= this.limit) return false;
    existing.count += 1;
    return true;
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
