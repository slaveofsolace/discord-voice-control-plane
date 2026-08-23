/* eslint-disable security/detect-non-literal-fs-filename -- tests use isolated OS temporary directories */
import { copyFile, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { type RelayRequest, type RelayStatusEvent } from "@discord-vc-control/contracts";

import { EncryptedRelayQueue } from "./relay-queue.js";

const roots: string[] = [];
const ids = {
  actor: "100000000000000001",
  application: "100000000000000002",
  controlGuild: "100000000000000003",
  controlChannel: "100000000000000004",
  source: "100000000000000005",
  targetGuild: "100000000000000006",
  targetVoice: "100000000000000007",
  targetText: "100000000000000008"
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function request(
  index: number,
  now: number,
  content = `secret relay content ${index}`
): RelayRequest {
  const requestId = `00000000-0000-5000-8000-${String(index).padStart(12, "0")}`;
  return {
    request_id: requestId,
    command_id: requestId,
    deployment_id: "test",
    tenant_id: "test",
    profile_name: "main",
    source_application_id: ids.application,
    source_message_id: String(BigInt(ids.source) + BigInt(index)),
    actor_user_id: ids.actor,
    actor_role_ids: [],
    control_guild_id: ids.controlGuild,
    control_channel_id: ids.controlChannel,
    target_guild_id: ids.targetGuild,
    target_voice_channel_id: ids.targetVoice,
    target_text_channel_id: ids.targetText,
    content_kind: "ordinary_chat",
    risk: "OPERATOR",
    parsed_command: null,
    content,
    status: "RECEIVED",
    result_code: "PENDING_USER_APPROVAL",
    created_at: now + index,
    updated_at: now + index,
    expires_at: now + 30 * 60_000
  };
}

async function harness(input: { maxPending?: number; now?: () => number } = {}) {
  const root = await mkdtemp(join(tmpdir(), "discord-relay-queue-"));
  roots.push(root);
  const events: RelayStatusEvent[] = [];
  const queue = new EncryptedRelayQueue({
    deploymentId: "test",
    profileName: "main",
    secretRoot: root,
    onStatus: (event) => {
      events.push(event);
    },
    ...(input.maxPending === undefined ? {} : { maxPending: input.maxPending }),
    ...(input.now === undefined ? {} : { now: input.now })
  });
  await queue.initialize();
  return { events, queue, root };
}

describe("encrypted relay approval queue", () => {
  it("encrypts content at rest and survives a restart", async () => {
    const now = Date.now();
    const { queue, root } = await harness();
    await queue.enqueue(request(1, now));
    const raw = await readFile(queue.statePath, "utf8");
    expect(raw).not.toContain("secret relay content");
    expect(raw).not.toContain(ids.actor);
    const restarted = new EncryptedRelayQueue({
      deploymentId: "test",
      profileName: "main",
      secretRoot: root,
      onStatus: vi.fn()
    });
    await restarted.initialize();
    expect(await restarted.list()).toMatchObject([
      { content: "secret relay content 1", status: "PENDING_USER_APPROVAL" }
    ]);
  });

  it("detects authenticated-encryption tampering", async () => {
    const { queue, root } = await harness();
    await queue.enqueue(request(1, Date.now()));
    const envelope = JSON.parse(await readFile(queue.statePath, "utf8")) as {
      ciphertext: string;
    };
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -1)}${envelope.ciphertext.endsWith("A") ? "B" : "A"}`;
    await writeFile(queue.statePath, JSON.stringify(envelope), "utf8");
    const restarted = new EncryptedRelayQueue({
      deploymentId: "test",
      profileName: "main",
      secretRoot: root,
      onStatus: vi.fn()
    });
    await expect(restarted.initialize()).rejects.toThrow();
  });

  it("recovers the last atomic backup after an interrupted rename", async () => {
    const { queue, root } = await harness();
    await queue.enqueue(request(1, Date.now()));
    await rename(queue.statePath, queue.statePath.replace(".enc.json", ".backup.enc.json"));
    const restarted = new EncryptedRelayQueue({
      deploymentId: "test",
      profileName: "main",
      secretRoot: root,
      onStatus: vi.fn()
    });
    await restarted.initialize();
    expect(await restarted.list()).toHaveLength(1);
  });

  it("keeps FIFO order, enforces the cap, and treats duplicate IDs idempotently", async () => {
    const { queue } = await harness({ maxPending: 2 });
    const now = Date.now();
    await queue.enqueue(request(2, now));
    await queue.enqueue(request(1, now));
    await expect(queue.enqueue(request(3, now))).rejects.toThrow("RELAY_QUEUE_FULL");
    await expect(queue.enqueue(request(2, now))).resolves.toMatchObject({
      status: "PENDING_USER_APPROVAL"
    });
    expect((await queue.list()).map((item) => item.request_id)).toEqual([
      request(1, now).request_id,
      request(2, now).request_id
    ]);
  });

  it("expires requests and purges content from every terminal state", async () => {
    let now = 10_000;
    const { events, queue } = await harness({ now: () => now });
    const item = request(1, now);
    item.expires_at = now + 5;
    await queue.enqueue(item);
    now += 6;
    await queue.expire();
    expect(await queue.get(item.request_id)).toMatchObject({
      content: null,
      status: "EXPIRED",
      result_code: "REQUEST_EXPIRED"
    });
    expect(events.map((event) => event.status)).toEqual([
      "RECEIVED",
      "PENDING_USER_APPROVAL",
      "EXPIRED"
    ]);
  });

  it("cancels nonterminal requests when the target or profile authorization changes", async () => {
    const { queue } = await harness();
    const item = request(1, Date.now());
    await queue.enqueue(item);
    expect(
      await queue.invalidateContext({
        profileName: "main",
        targetGuildId: ids.targetGuild,
        targetTextChannelId: "100000000000000099",
        targetVoiceChannelId: ids.targetVoice
      })
    ).toBe(1);
    expect(await queue.get(item.request_id)).toMatchObject({
      content: null,
      status: "CANCELLED"
    });
  });

  it("keeps main and future presence profiles on separate keys and queue files", async () => {
    const { queue, root } = await harness();
    await queue.enqueue(request(1, Date.now()));
    const presence = new EncryptedRelayQueue({
      deploymentId: "test",
      profileName: "presence",
      secretRoot: root,
      onStatus: vi.fn()
    });
    await presence.initialize();
    const presenceRequest = { ...request(2, Date.now()), profile_name: "presence" };
    await presence.enqueue(presenceRequest);
    expect(presence.statePath).not.toBe(queue.statePath);
    expect(await readFile(join(root, "main.relay-queue.key"), "utf8")).not.toBe(
      await readFile(join(root, "presence.relay-queue.key"), "utf8")
    );
    expect((await queue.list()).map((item) => item.profile_name)).toEqual(["main"]);
    expect((await presence.list()).map((item) => item.profile_name)).toEqual(["presence"]);
  });

  it("rejects an authenticated queue copied across profile boundaries", async () => {
    const { queue, root } = await harness();
    await queue.enqueue(request(1, Date.now()));
    await copyFile(join(root, "main.relay-queue.key"), join(root, "presence.relay-queue.key"));
    await copyFile(queue.statePath, join(root, "presence.relay-queue.enc.json"));
    const presence = new EncryptedRelayQueue({
      deploymentId: "test",
      profileName: "presence",
      secretRoot: root,
      onStatus: vi.fn()
    });
    await expect(presence.initialize()).rejects.toThrow("RELAY_QUEUE_RECOVERY_FAILED");
  });

  it("allows prepare rollback but never transitions a terminal receipt", async () => {
    const { queue } = await harness();
    const item = request(1, Date.now());
    await queue.enqueue(item);
    await queue.transition(item.request_id, "PREPARED_FOR_MANUAL_SEND", "PREPARED_FOR_MANUAL_SEND");
    await queue.transition(item.request_id, "PENDING_USER_APPROVAL", "PENDING_USER_APPROVAL");
    await queue.transition(item.request_id, "OWNER_REJECTED", "OWNER_REJECTED");
    expect(await queue.get(item.request_id)).toMatchObject({
      content: null,
      status: "OWNER_REJECTED"
    });
    await expect(
      queue.transition(item.request_id, "PENDING_USER_APPROVAL", "PENDING_USER_APPROVAL")
    ).rejects.toThrow("RELAY_STATE_TRANSITION_INVALID");
  });
});
