import { afterEach, describe, expect, it, vi } from "vitest";

import { exchangeRpcAuthorizationCode, refreshRpcAccessToken } from "./oauth.js";

const client = {
  clientId: "100000000000000001",
  clientSecret: "application-client-secret",
  redirectUri: "https://localhost/rpc/callback"
};

function tokenResponse() {
  return new Response(
    JSON.stringify({
      access_token: "oauth-access-token-value",
      expires_in: 3600,
      refresh_token: "oauth-refresh-token-value",
      scope: "rpc identify",
      token_type: "Bearer"
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Discord RPC OAuth exchange", () => {
  it("uses the official token endpoint with a form body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(tokenResponse());
    vi.stubGlobal("fetch", fetchMock);
    const token = await exchangeRpcAuthorizationCode(client, "one-time-code");
    expect(token).toMatchObject({
      accessToken: "oauth-access-token-value",
      refreshToken: "oauth-refresh-token-value",
      scope: "rpc identify"
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://discord.com/api/oauth2/token");
    expect(url).not.toContain(client.clientSecret);
    expect(request.method).toBe("POST");
    expect(request.body).toBeInstanceOf(URLSearchParams);
    expect((request.body as URLSearchParams).get("grant_type")).toBe("authorization_code");
  });

  it("refreshes without putting the refresh token in the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(tokenResponse());
    vi.stubGlobal("fetch", fetchMock);
    await refreshRpcAccessToken(client, "existing-refresh-token");
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("existing-refresh-token");
    expect((request.body as URLSearchParams).get("grant_type")).toBe("refresh_token");
    expect((request.body as URLSearchParams).get("refresh_token")).toBe("existing-refresh-token");
  });
});
