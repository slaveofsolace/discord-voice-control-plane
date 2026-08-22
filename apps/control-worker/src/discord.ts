import { verifyKey } from "discord-interactions";

const maxTimestampAgeMs = 5 * 60_000;
export const maxInteractionBodyBytes = 64 * 1024;

export class InteractionBodyTooLargeError extends Error {
  constructor() {
    super("INTERACTION_BODY_TOO_LARGE");
  }
}

export function hasDiscordSignatureHeaders(request: Request): boolean {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  return (
    signature !== null &&
    /^[a-f\d]{128}$/iu.test(signature) &&
    timestamp !== null &&
    /^\d+$/u.test(timestamp)
  );
}

export async function readInteractionBody(
  request: Request,
  maximumBytes = maxInteractionBodyBytes
): Promise<string> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximumBytes) {
      throw new InteractionBodyTooLargeError();
    }
  }
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new InteractionBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

export async function verifyDiscordRequest(
  request: Request,
  rawBody: string,
  publicKey: string,
  nowMs = Date.now()
): Promise<boolean> {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  if (!hasDiscordSignatureHeaders(request) || signature === null || timestamp === null)
    return false;
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
