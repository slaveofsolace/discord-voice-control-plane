import { z } from "zod";

import { snowflakeSchema } from "@discord-vc-control/contracts";

import type { DiscordIpcClient } from "./discord-ipc.js";

const authorizationResponseSchema = z.object({ code: z.string().min(1) });
const authenticatedResponseSchema = z.object({
  user: z.object({ id: snowflakeSchema }),
  scopes: z.array(z.string()),
  expires: z.string()
});
const rpcChannelSchema = z.object({
  id: snowflakeSchema,
  guild_id: snowflakeSchema,
  name: z.string(),
  type: z.number().int()
});
const voiceSelectionSchema = z.object({
  channel_id: snowflakeSchema.nullable(),
  guild_id: snowflakeSchema.nullable()
});

export type RpcChannel = z.infer<typeof rpcChannelSchema>;
export type VoiceSelection = z.infer<typeof voiceSelectionSchema>;

export interface AuthenticatedRpcUser {
  expires: string;
  scopes: string[];
  userId: string;
}

const allowedAuthorizationScopes = new Set([
  "identify",
  "rpc",
  "rpc.voice.read",
  "rpc.voice.write"
]);

export class DiscordRpcSession {
  constructor(
    private readonly ipc: DiscordIpcClient,
    private readonly clientId: string
  ) {}

  async connect(): Promise<void> {
    await this.ipc.connect();
  }

  close(): void {
    this.ipc.close();
  }

  onDisconnect(handler: (code: string) => void): () => void {
    return this.ipc.onDisconnect(handler);
  }

  async authorize(scopes: string[] = ["rpc", "identify"]): Promise<string> {
    if (scopes.some((scope) => !allowedAuthorizationScopes.has(scope))) {
      throw new Error("UNSUPPORTED_RPC_SCOPE");
    }
    const response = authorizationResponseSchema.parse(
      await this.ipc.request("AUTHORIZE", { client_id: this.clientId, scopes })
    );
    return response.code;
  }

  async authenticate(accessToken: string): Promise<AuthenticatedRpcUser> {
    const response = authenticatedResponseSchema.parse(
      await this.ipc.request("AUTHENTICATE", { access_token: accessToken })
    );
    return {
      expires: response.expires,
      scopes: response.scopes,
      userId: response.user.id
    };
  }

  async getSelectedVoiceChannel(): Promise<RpcChannel | null> {
    return this.parseChannel(await this.ipc.request("GET_SELECTED_VOICE_CHANNEL"));
  }

  async selectVoiceChannel(
    channelId: string | null,
    options: { force?: boolean; navigate?: boolean } = {}
  ): Promise<RpcChannel | null> {
    const args: Record<string, unknown> = {
      channel_id: channelId,
      timeout: 10_000,
      navigate: options.navigate ?? false
    };
    if (options.force !== undefined) args.force = options.force;
    return this.parseChannel(
      await this.ipc.request("SELECT_VOICE_CHANNEL", args, { timeoutMs: 15_000 })
    );
  }

  async selectTextChannel(channelId: string): Promise<RpcChannel | null> {
    return this.parseChannel(
      await this.ipc.request(
        "SELECT_TEXT_CHANNEL",
        { channel_id: channelId, timeout: 10_000 },
        { timeoutMs: 15_000 }
      )
    );
  }

  async subscribeVoiceSelection(handler: (selection: VoiceSelection) => void): Promise<() => void> {
    const unsubscribe = this.ipc.on("VOICE_CHANNEL_SELECT", (data) =>
      handler(voiceSelectionSchema.parse(data))
    );
    try {
      await this.ipc.request("SUBSCRIBE", {}, { event: "VOICE_CHANNEL_SELECT" });
    } catch (error) {
      unsubscribe();
      throw error;
    }
    return unsubscribe;
  }

  private parseChannel(input: unknown): RpcChannel | null {
    return input === null ? null : rpcChannelSchema.parse(input);
  }
}
