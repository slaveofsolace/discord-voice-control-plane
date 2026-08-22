import {
  relayIngressRequestSchema,
  relayResultCodeSchema,
  relayStatusSchema,
  type RelayIngressRequest,
  type RelayStatus
} from "@discord-vc-control/contracts";
import { signRelayIngress } from "@discord-vc-control/security";
import { z } from "zod";

const ingressResponseSchema = z
  .object({
    accepted: z.boolean(),
    duplicate: z.boolean().default(false),
    request_id: z.uuid().nullable(),
    status: relayStatusSchema.nullable(),
    result_code: relayResultCodeSchema.or(z.string().min(1).max(64))
  })
  .strict();

export interface RelayIngressResponse {
  accepted: boolean;
  duplicate: boolean;
  request_id: string | null;
  result_code: string;
  status: RelayStatus | null;
}

export class RelayIngressClient {
  constructor(
    private readonly options: {
      endpoint: string;
      fetch?: typeof fetch;
      secret: string;
    }
  ) {}

  async send(input: RelayIngressRequest): Promise<RelayIngressResponse> {
    const request = relayIngressRequestSchema.parse(input);
    const rawBody = JSON.stringify(request);
    if (Buffer.byteLength(rawBody, "utf8") > 16 * 1024) throw new Error("RELAY_BODY_TOO_LARGE");
    const timestamp = Date.now();
    const nonce = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    const signature = await signRelayIngress({ nonce, rawBody, timestamp }, this.options.secret);
    const response = await (this.options.fetch ?? fetch)(this.options.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-relay-nonce": nonce,
        "x-relay-signature": signature,
        "x-relay-timestamp": String(timestamp)
      },
      body: rawBody,
      redirect: "error"
    });
    const responseText = await response.text();
    if (responseText.length > 16 * 1024) throw new Error("RELAY_RESPONSE_TOO_LARGE");
    if (!response.ok) {
      let code = `RELAY_INGRESS_${response.status}`;
      try {
        const body = JSON.parse(responseText) as { result_code?: unknown };
        if (typeof body.result_code === "string") code = body.result_code.slice(0, 64);
      } catch {
        // The public error code remains status-bounded when the response is not JSON.
      }
      throw new Error(code);
    }
    return ingressResponseSchema.parse(JSON.parse(responseText));
  }
}
