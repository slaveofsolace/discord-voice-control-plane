import type { UnsignedCommandEnvelope } from "@discord-vc-control/contracts";

export function commandFixture(
  overrides: Partial<UnsignedCommandEnvelope> = {}
): UnsignedCommandEnvelope {
  const issuedAt = 1_800_000_000_000;
  return {
    version: 1,
    command_id: "123e4567-e89b-42d3-a456-426614174000",
    issued_at: issuedAt,
    expires_at: issuedAt + 30_000,
    nonce: "fixture-nonce-00000001",
    actor_user_id: "100000000000000001",
    control_guild_id: "100000000000000002",
    control_channel_id: "100000000000000003",
    deployment_id: "fixture",
    tenant_id: "fixture",
    action: "status",
    payload: {},
    kid: "fixture-v1",
    ...overrides
  };
}
