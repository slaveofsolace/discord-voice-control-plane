/* eslint-disable security/detect-non-literal-fs-filename -- queue, key, backup, and temporary paths stay beneath the configured protected profile root */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";

import {
  relayRequestSchema,
  type RelayRequest,
  type RelayResultCode,
  type RelayStatus,
  type RelayStatusEvent
} from "@discord-vc-control/contracts";

interface EncryptedQueueFile {
  ciphertext: string;
  iv: string;
  tag: string;
  version: 1;
}

const terminalStatuses = new Set<RelayStatus>([
  "OWNER_CONFIRMED_SENT",
  "OWNER_REJECTED",
  "EXPIRED",
  "CANCELLED"
]);

const allowedTransitions: Readonly<Record<RelayStatus, ReadonlySet<RelayStatus>>> = {
  RECEIVED: new Set(["PENDING_USER_APPROVAL", "EXPIRED", "CANCELLED"]),
  PENDING_USER_APPROVAL: new Set([
    "PREPARED_FOR_MANUAL_SEND",
    "OWNER_REJECTED",
    "EXPIRED",
    "CANCELLED"
  ]),
  PREPARED_FOR_MANUAL_SEND: new Set([
    "PENDING_USER_APPROVAL",
    "OWNER_CONFIRMED_SENT",
    "OWNER_REJECTED",
    "EXPIRED",
    "CANCELLED"
  ]),
  OWNER_CONFIRMED_SENT: new Set(),
  OWNER_REJECTED: new Set(),
  EXPIRED: new Set(),
  CANCELLED: new Set()
};

function cloneRequest(request: RelayRequest): RelayRequest {
  return structuredClone(request);
}

export class EncryptedRelayQueue {
  readonly #backupPath: string;
  readonly #keyPath: string;
  readonly #statePath: string;
  #items: RelayRequest[] = [];
  #key: Buffer | null = null;
  #mutation: Promise<void> = Promise.resolve();

  constructor(
    private readonly options: {
      deploymentId: string;
      maxPending?: number;
      now?: () => number;
      onStatus: (event: RelayStatusEvent) => Promise<void> | void;
      profileName: string;
      secretRoot: string;
      ttlMs?: number;
    }
  ) {
    const basename = `${options.profileName}.relay-queue`;
    this.#statePath = resolve(options.secretRoot, `${basename}.enc.json`);
    this.#backupPath = resolve(options.secretRoot, `${basename}.backup.enc.json`);
    this.#keyPath = resolve(options.secretRoot, `${basename}.key`);
  }

  get statePath(): string {
    return this.#statePath;
  }

  async initialize(): Promise<void> {
    await mkdir(this.options.secretRoot, { recursive: true, mode: 0o700 });
    this.#key = await this.loadOrCreateKey();
    this.#items = await this.loadItems();
    await this.expire();
  }

  async enqueue(request: RelayRequest): Promise<RelayRequest> {
    return this.mutate(async () => {
      this.expireInMemory();
      const existing = this.#items.find((item) => item.request_id === request.request_id);
      if (existing !== undefined) return cloneRequest(existing);
      const pendingCount = this.#items.filter((item) => !terminalStatuses.has(item.status)).length;
      if (pendingCount >= (this.options.maxPending ?? 50)) throw new Error("RELAY_QUEUE_FULL");
      const validated = relayRequestSchema.parse(request);
      if (validated.profile_name !== this.options.profileName) {
        throw new Error("RELAY_PROFILE_MISMATCH");
      }
      this.#items.push(validated);
      await this.persist();
      this.emitStatus(validated);
      const pending = this.transitionInMemory(
        validated.request_id,
        "PENDING_USER_APPROVAL",
        "PENDING_USER_APPROVAL"
      );
      await this.persist();
      this.emitStatus(pending);
      return cloneRequest(pending);
    });
  }

  async list(): Promise<RelayRequest[]> {
    await this.expire();
    return this.#items
      .map(cloneRequest)
      .sort(
        (left, right) =>
          left.created_at - right.created_at || left.request_id.localeCompare(right.request_id)
      );
  }

  async get(requestId: string): Promise<RelayRequest | null> {
    await this.expire();
    const item = this.#items.find((candidate) => candidate.request_id === requestId);
    return item === undefined ? null : cloneRequest(item);
  }

  async transition(
    requestId: string,
    status: RelayStatus,
    resultCode: RelayResultCode
  ): Promise<RelayRequest> {
    return this.mutate(async () => {
      this.expireInMemory();
      const changed = this.transitionInMemory(requestId, status, resultCode);
      await this.persist();
      this.emitStatus(changed);
      return cloneRequest(changed);
    });
  }

  async expire(): Promise<void> {
    await this.mutate(async () => {
      const changed = this.expireInMemory();
      if (changed.length === 0) return;
      await this.persist();
      for (const request of changed) this.emitStatus(request);
    });
  }

  async invalidateContext(input: {
    force?: boolean;
    profileName: string;
    targetGuildId: string | null;
    targetTextChannelId: string | null;
    targetVoiceChannelId: string | null;
  }): Promise<number> {
    return this.mutate(async () => {
      const invalidated: RelayRequest[] = [];
      for (const request of this.#items) {
        if (terminalStatuses.has(request.status)) continue;
        if (
          input.force === true ||
          request.profile_name !== input.profileName ||
          request.target_guild_id !== input.targetGuildId ||
          request.target_text_channel_id !== input.targetTextChannelId ||
          request.target_voice_channel_id !== input.targetVoiceChannelId
        ) {
          request.status = "CANCELLED";
          request.result_code = "REQUEST_CANCELLED";
          request.updated_at = this.now();
          request.content = null;
          invalidated.push(request);
        }
      }
      if (invalidated.length === 0) return 0;
      await this.persist();
      for (const request of invalidated) this.emitStatus(request);
      return invalidated.length;
    });
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    let resolveResult: (value: T | PromiseLike<T>) => void = () => undefined;
    let rejectResult: (reason?: unknown) => void = () => undefined;
    const result = new Promise<T>((resolvePromise, rejectPromise) => {
      resolveResult = resolvePromise;
      rejectResult = rejectPromise;
    });
    const run = this.#mutation.then(operation);
    this.#mutation = run.then(
      (value) => resolveResult(value),
      (error: unknown) => rejectResult(error)
    );
    await this.#mutation;
    return result;
  }

  private transitionInMemory(
    requestId: string,
    status: RelayStatus,
    resultCode: RelayResultCode
  ): RelayRequest {
    const item = this.#items.find((candidate) => candidate.request_id === requestId);
    if (item === undefined) throw new Error("RELAY_REQUEST_NOT_FOUND");
    if (!allowedTransitions[item.status].has(status)) {
      if (item.status === status && item.result_code === resultCode) return item;
      throw new Error("RELAY_STATE_TRANSITION_INVALID");
    }
    item.status = status;
    item.result_code = resultCode;
    item.updated_at = this.now();
    if (terminalStatuses.has(status)) item.content = null;
    return item;
  }

  private expireInMemory(): RelayRequest[] {
    const now = this.now();
    const changed: RelayRequest[] = [];
    for (const item of this.#items) {
      if (!terminalStatuses.has(item.status) && item.expires_at <= now) {
        item.status = "EXPIRED";
        item.result_code = "REQUEST_EXPIRED";
        item.updated_at = now;
        item.content = null;
        changed.push(item);
      }
    }
    return changed;
  }

  private emitStatus(request: RelayRequest): void {
    void this.options.onStatus({
      type: "relay_status",
      deployment_id: this.options.deploymentId,
      request_id: request.request_id,
      command_id: request.command_id,
      actor_user_id: request.actor_user_id,
      source_application_id: request.source_application_id,
      source_message_id: request.source_message_id,
      status: request.status,
      result_code: request.result_code,
      occurred_at: request.updated_at
    });
  }

  private async loadOrCreateKey(): Promise<Buffer> {
    try {
      const encoded = await readFile(this.#keyPath, "utf8");
      const key = Buffer.from(encoded.trim(), "base64url");
      if (key.byteLength !== 32) throw new Error("RELAY_QUEUE_KEY_INVALID");
      return key;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const key = randomBytes(32);
    const handle = await open(this.#keyPath, "wx", 0o600);
    try {
      await handle.writeFile(`${key.toString("base64url")}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(this.#keyPath, 0o600).catch(() => undefined);
    return key;
  }

  private async loadItems(): Promise<RelayRequest[]> {
    let primaryFailed = false;
    for (const path of [this.#statePath, this.#backupPath]) {
      try {
        const raw = await readFile(path, "utf8");
        return this.decrypt(raw);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        if (path === this.#backupPath) {
          throw new Error("RELAY_QUEUE_RECOVERY_FAILED", { cause: error });
        }
        primaryFailed = true;
      }
    }
    if (primaryFailed) throw new Error("RELAY_QUEUE_RECOVERY_FAILED");
    return [];
  }

  private decrypt(raw: string): RelayRequest[] {
    if (this.#key === null) throw new Error("RELAY_QUEUE_NOT_INITIALIZED");
    const envelope = JSON.parse(raw) as EncryptedQueueFile;
    if (envelope.version !== 1) throw new Error("RELAY_QUEUE_VERSION_UNSUPPORTED");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.#key,
      Buffer.from(envelope.iv, "base64url")
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
      decipher.final()
    ]).toString("utf8");
    const input = JSON.parse(plaintext) as unknown;
    if (!Array.isArray(input)) throw new Error("RELAY_QUEUE_STATE_INVALID");
    return input.map((item) => {
      const request = relayRequestSchema.parse(item);
      if (request.profile_name !== this.options.profileName) {
        throw new Error("RELAY_PROFILE_MISMATCH");
      }
      if (request.deployment_id !== this.options.deploymentId) {
        throw new Error("RELAY_DEPLOYMENT_MISMATCH");
      }
      return request;
    });
  }

  private encrypt(): string {
    if (this.#key === null) throw new Error("RELAY_QUEUE_NOT_INITIALIZED");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    const plaintext = Buffer.from(JSON.stringify(this.#items), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return `${JSON.stringify({
      version: 1,
      iv: iv.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url")
    } satisfies EncryptedQueueFile)}\n`;
  }

  private async persist(): Promise<void> {
    const temporaryPath = `${this.#statePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(this.encrypt(), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await unlink(this.#backupPath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
    await rename(this.#statePath, this.#backupPath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
    await rename(temporaryPath, this.#statePath);
    await chmod(this.#statePath, 0o600).catch(() => undefined);
    await unlink(this.#backupPath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }
}
