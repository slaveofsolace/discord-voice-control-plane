import { describe, expect, it, vi } from "vitest";

import { verifyRelayIngress } from "@discord-vc-control/security";

import { RelayIngressClient } from "./relay-ingress-client.js";

const secret = "relay-ingress-secret-with-at-least-thirty-two-bytes";
const request = {
  version: 1 as const,
  operation: "create" as const,
  deployment_id: "test",
  tenant_id: "test",
  application_id: "100000000000000001",
  source_message_id: "100000000000000002",
  actor_user_id: "100000000000000003",
  actor_role_ids: [],
  control_guild_id: "100000000000000004",
  control_channel_id: "100000000000000005",
  content: "ordinary text"
};

describe("relay ingress client", () => {
  it("signs the exact bounded body with a fresh timestamp and nonce", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const headers = new Headers(init?.headers);
      const rawBody = String(init?.body);
      expect(
        await verifyRelayIngress(
          {
            nonce: headers.get("x-relay-nonce") ?? "",
            rawBody,
            signature: headers.get("x-relay-signature") ?? "",
            timestamp: Number(headers.get("x-relay-timestamp"))
          },
          secret
        )
      ).toBe(true);
      expect(rawBody).toContain("ordinary text");
      return Response.json({
        accepted: true,
        duplicate: false,
        request_id: "00000000-0000-5000-8000-000000000001",
        status: "PENDING_USER_APPROVAL",
        result_code: "PENDING_USER_APPROVAL"
      });
    });
    const client = new RelayIngressClient({
      endpoint: "https://control.example/internal/relay-ingress",
      fetch: fetchMock,
      secret
    });
    await expect(client.send(request)).resolves.toMatchObject({
      accepted: true,
      status: "PENDING_USER_APPROVAL"
    });
  });

  it("returns only a bounded public result code for failed ingress", async () => {
    const client = new RelayIngressClient({
      endpoint: "https://control.example/internal/relay-ingress",
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ result_code: "LOCAL_AGENT_OFFLINE" }, { status: 409 })),
      secret
    });
    await expect(client.send(request)).rejects.toThrow("LOCAL_AGENT_OFFLINE");
  });
});
