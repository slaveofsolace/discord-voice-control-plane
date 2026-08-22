import { randomUUID } from "node:crypto";
import { type Duplex } from "node:stream";
import { createConnection } from "node:net";

export const rpcOpcode = {
  handshake: 0,
  frame: 1,
  close: 2,
  ping: 3,
  pong: 4
} as const;

export interface RpcFrame {
  opcode: number;
  payload: unknown;
}

interface RpcPayload {
  cmd: string;
  data?: unknown;
  evt?: string;
  nonce?: string;
}

interface PendingRequest {
  reject: (error: Error) => void;
  resolve: (value: unknown) => void;
  timer: NodeJS.Timeout;
}

export type RpcEventHandler = (data: unknown) => void;
export type RpcDisconnectHandler = (code: string) => void;
export type PipeConnector = (path: string) => Promise<Duplex>;

const maximumFrameBytes = 1024 * 1024;
const pipeCount = 10;

export function discordIpcPipePath(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= pipeCount) {
    throw new Error("INVALID_DISCORD_IPC_INDEX");
  }
  return `\\\\?\\pipe\\discord-ipc-${index}`;
}

export function encodeRpcFrame(opcode: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  if (body.length > maximumFrameBytes) throw new Error("RPC_FRAME_TOO_LARGE");
  const header = Buffer.allocUnsafe(8);
  header.writeUInt32LE(opcode, 0);
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

export function decodeRpcFrames(input: Buffer): { frames: RpcFrame[]; remainder: Buffer } {
  const frames: RpcFrame[] = [];
  let offset = 0;
  while (input.length - offset >= 8) {
    const opcode = input.readUInt32LE(offset);
    const length = input.readUInt32LE(offset + 4);
    if (length > maximumFrameBytes) throw new Error("RPC_FRAME_TOO_LARGE");
    if (input.length - offset - 8 < length) break;
    const body = input.subarray(offset + 8, offset + 8 + length).toString("utf8");
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new Error("INVALID_RPC_JSON");
    }
    frames.push({ opcode, payload });
    offset += 8 + length;
  }
  return { frames, remainder: input.subarray(offset) };
}

function defaultConnector(path: string): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    const timer = setTimeout(() => {
      socket.destroy(new Error("DISCORD_RPC_PIPE_CONNECT_TIMEOUT"));
    }, 1_000);
    const onError = (error: Error): void => {
      clearTimeout(timer);
      socket.off("connect", onConnect);
      reject(error);
    };
    const onConnect = (): void => {
      clearTimeout(timer);
      socket.off("error", onError);
      resolve(socket);
    };
    socket.once("error", onError);
    socket.once("connect", onConnect);
  });
}

function asRpcPayload(input: unknown): RpcPayload {
  if (typeof input !== "object" || input === null) throw new Error("INVALID_RPC_PAYLOAD");
  const candidate = input as Record<string, unknown>;
  if (typeof candidate.cmd !== "string") throw new Error("INVALID_RPC_PAYLOAD");
  return {
    cmd: candidate.cmd,
    ...(candidate.data === undefined ? {} : { data: candidate.data }),
    ...(typeof candidate.evt === "string" ? { evt: candidate.evt } : {}),
    ...(typeof candidate.nonce === "string" ? { nonce: candidate.nonce } : {})
  };
}

export class DiscordIpcClient {
  readonly #disconnectHandlers = new Set<RpcDisconnectHandler>();
  readonly #eventHandlers = new Map<string, Set<RpcEventHandler>>();
  readonly #pending = new Map<string, PendingRequest>();
  #buffer: Buffer = Buffer.alloc(0);
  #closed = false;
  #readyReject: ((error: Error) => void) | null = null;
  #readyResolve: (() => void) | null = null;
  #socket: Duplex | null = null;

  constructor(
    private readonly clientId: string,
    private readonly connector: PipeConnector = defaultConnector
  ) {}

  get connected(): boolean {
    return this.#socket !== null && !this.#closed;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    let lastError: Error | null = null;
    for (let index = 0; index < pipeCount; index += 1) {
      try {
        const socket = await this.connector(discordIpcPipePath(index));
        this.bind(socket);
        const ready = new Promise<void>((resolve, reject) => {
          this.#readyResolve = resolve;
          this.#readyReject = reject;
        });
        socket.write(encodeRpcFrame(rpcOpcode.handshake, { v: 1, client_id: this.clientId }));
        let timeout: NodeJS.Timeout | undefined;
        try {
          await Promise.race([
            ready,
            new Promise((_resolve, reject) => {
              timeout = setTimeout(() => reject(new Error("DISCORD_RPC_READY_TIMEOUT")), 5_000);
            })
          ]);
        } finally {
          if (timeout !== undefined) clearTimeout(timeout);
        }
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("DISCORD_RPC_CONNECT_FAILED");
        this.closeSocket();
      }
    }
    throw lastError ?? new Error("DISCORD_RPC_PIPE_NOT_FOUND");
  }

  close(): void {
    this.#closed = true;
    const socket = this.#socket;
    this.#socket = null;
    socket?.end();
    this.rejectPending(new Error("DISCORD_RPC_CLOSED"));
  }

  on(event: string, handler: RpcEventHandler): () => void {
    const handlers = this.#eventHandlers.get(event) ?? new Set<RpcEventHandler>();
    handlers.add(handler);
    this.#eventHandlers.set(event, handlers);
    return () => handlers.delete(handler);
  }

  onDisconnect(handler: RpcDisconnectHandler): () => void {
    this.#disconnectHandlers.add(handler);
    return () => this.#disconnectHandlers.delete(handler);
  }

  async request(
    command: string,
    args: Record<string, unknown> = {},
    options: { event?: string; timeoutMs?: number } = {}
  ): Promise<unknown> {
    const socket = this.#socket;
    if (socket === null || this.#closed) throw new Error("DISCORD_RPC_NOT_CONNECTED");
    const nonce = randomUUID();
    const timeoutMs = options.timeoutMs ?? 15_000;
    const response = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(nonce);
        reject(new Error("DISCORD_RPC_REQUEST_TIMEOUT"));
      }, timeoutMs);
      this.#pending.set(nonce, { resolve, reject, timer });
    });
    socket.write(
      encodeRpcFrame(rpcOpcode.frame, {
        cmd: command,
        args,
        nonce,
        ...(options.event === undefined ? {} : { evt: options.event })
      })
    );
    return response;
  }

  private bind(socket: Duplex): void {
    this.#closed = false;
    this.#socket = socket;
    this.#buffer = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer | string) => {
      const next = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      if (this.#buffer.length + next.length > maximumFrameBytes + 8) {
        this.fail(new Error("RPC_BUFFER_TOO_LARGE"));
        return;
      }
      this.#buffer = Buffer.concat([this.#buffer, next]);
      try {
        const decoded = decodeRpcFrames(this.#buffer);
        this.#buffer = decoded.remainder;
        for (const frame of decoded.frames) this.handleFrame(frame);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error("INVALID_RPC_FRAME"));
      }
    });
    socket.once("error", (error: Error) => this.fail(error));
    socket.once("close", () => this.fail(new Error("DISCORD_RPC_PIPE_CLOSED")));
  }

  private handleFrame(frame: RpcFrame): void {
    if (frame.opcode === rpcOpcode.ping) {
      this.#socket?.write(encodeRpcFrame(rpcOpcode.pong, frame.payload));
      return;
    }
    if (frame.opcode === rpcOpcode.close) {
      this.fail(new Error("DISCORD_RPC_REMOTE_CLOSE"));
      return;
    }
    if (frame.opcode !== rpcOpcode.frame) throw new Error("INVALID_RPC_OPCODE");
    const payload = asRpcPayload(frame.payload);
    if (payload.evt === "READY" && payload.nonce === undefined) {
      this.#readyResolve?.();
      this.#readyResolve = null;
      this.#readyReject = null;
      return;
    }
    if (payload.nonce !== undefined) {
      const pending = this.#pending.get(payload.nonce);
      if (pending !== undefined) {
        clearTimeout(pending.timer);
        this.#pending.delete(payload.nonce);
        if (payload.evt === "ERROR") {
          pending.reject(new Error(this.rpcErrorCode(payload.data)));
        } else {
          pending.resolve(payload.data);
        }
        return;
      }
    }
    if (payload.evt !== undefined) {
      for (const handler of this.#eventHandlers.get(payload.evt) ?? []) handler(payload.data);
    }
  }

  private rpcErrorCode(data: unknown): string {
    if (typeof data === "object" && data !== null) {
      const code = (data as Record<string, unknown>).code;
      if (
        (typeof code === "number" && Number.isInteger(code) && code >= 0 && code <= 999_999) ||
        (typeof code === "string" && /^\d{1,6}$/u.test(code))
      )
        return `DISCORD_RPC_ERROR_${code}`;
    }
    return "DISCORD_RPC_ERROR";
  }

  private fail(error: Error): void {
    const wasConnected = this.#socket !== null;
    this.#readyReject?.(error);
    this.#readyReject = null;
    this.#readyResolve = null;
    this.closeSocket();
    this.rejectPending(error);
    if (wasConnected) {
      const code = /^[A-Z\d_]{1,64}$/u.test(error.message)
        ? error.message
        : "DISCORD_RPC_PIPE_FAILED";
      for (const handler of this.#disconnectHandlers) handler(code);
    }
  }

  private closeSocket(): void {
    const socket = this.#socket;
    this.#socket = null;
    this.#closed = true;
    socket?.destroy();
  }

  private rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
