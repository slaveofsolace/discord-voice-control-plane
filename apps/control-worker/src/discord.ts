import { verifyKey } from "discord-interactions";

const maxTimestampAgeMs = 5 * 60_000;

export async function verifyDiscordRequest(
  request: Request,
  rawBody: string,
  publicKey: string,
  nowMs = Date.now()
): Promise<boolean> {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  if (signature === null || timestamp === null || !/^\d+$/u.test(timestamp)) return false;
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isSafeInteger(timestampMs) || Math.abs(nowMs - timestampMs) > maxTimestampAgeMs) {
    return false;
  }
  try {
    return await verifyKey(rawBody, signature, timestamp, publicKey);
  } catch {
    return false;
  }
}

export function interactionResponse(content: string, status = 200): Response {
  return Response.json(
    {
      type: 4,
      data: {
        content,
        flags: 64,
        allowed_mentions: { parse: [] }
      }
    },
    { status }
  );
}

export function deferredInteractionResponse(): Response {
  return Response.json({ type: 5, data: { flags: 64 } });
}

export async function editInteractionResponse(input: {
  applicationId: string;
  content: string;
  interactionToken: string;
}): Promise<void> {
  const response = await fetch(
    `https://discord.com/api/v10/webhooks/${input.applicationId}/${input.interactionToken}/messages/@original`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: input.content, allowed_mentions: { parse: [] } })
    }
  );
  if (!response.ok) throw new Error(`DISCORD_INTERACTION_EDIT_${response.status}`);
}
