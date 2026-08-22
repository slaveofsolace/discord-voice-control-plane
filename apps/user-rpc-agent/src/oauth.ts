import { z } from "zod";

const oauthTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1),
  scope: z.string(),
  token_type: z.string()
});

export interface RpcOAuthTokens {
  accessToken: string;
  expiresAt: number;
  refreshToken: string;
  scope: string;
  tokenType: string;
}

interface OAuthClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

async function requestToken(parameters: URLSearchParams): Promise<RpcOAuthTokens> {
  const response = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: parameters
  });
  if (!response.ok) throw new Error(`DISCORD_OAUTH_TOKEN_HTTP_${response.status}`);
  const token = oauthTokenSchema.parse(await response.json());
  return {
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1_000,
    refreshToken: token.refresh_token,
    scope: token.scope,
    tokenType: token.token_type
  };
}

export async function exchangeRpcAuthorizationCode(
  client: OAuthClient,
  code: string
): Promise<RpcOAuthTokens> {
  return requestToken(
    new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: client.redirectUri
    })
  );
}

export async function refreshRpcAccessToken(
  client: OAuthClient,
  refreshToken: string
): Promise<RpcOAuthTokens> {
  return requestToken(
    new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      redirect_uri: client.redirectUri
    })
  );
}
