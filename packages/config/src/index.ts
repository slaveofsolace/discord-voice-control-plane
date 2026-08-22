import { snowflakeSchema } from "@discord-vc-control/contracts";
import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const csvSnowflakes = z
  .string()
  .default("")
  .transform((value, context) => {
    const ids = value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const parsed = z.array(snowflakeSchema).safeParse(ids);
    if (!parsed.success) {
      context.addIssue({ code: "custom", message: parsed.error.message });
      return z.NEVER;
    }
    return new Set(parsed.data);
  });

const optionalSnowflake = z.union([snowflakeSchema, z.literal("")]).default("");

const millisecondString = z
  .string()
  .regex(/^\d+$/u)
  .transform(Number)
  .pipe(z.number().int().min(10_000).max(300_000));

export const controlEnvironmentSchema = z
  .object({
    DEPLOYMENT_ID: z.string().min(1).max(64),
    TENANT_ID: z.string().min(1).max(64),
    CONTROL_DISCORD_APPLICATION_ID: snowflakeSchema,
    CONTROL_DISCORD_PUBLIC_KEY: z.string().regex(/^[a-f\d]{64}$/iu),
    CONTROL_GUILD_ID: snowflakeSchema,
    CONTROL_CHANNEL_IDS: csvSnowflakes,
    CONTROL_OPERATOR_USER_IDS: csvSnowflakes,
    CONTROL_OPERATOR_ROLE_IDS: csvSnowflakes,
    CONTROL_ELEVATED_USER_IDS: csvSnowflakes,
    CONTROL_ELEVATED_ROLE_IDS: csvSnowflakes,
    AGENT_AUTH_SECRET: z.string().min(32),
    AGENT_PREVIOUS_AUTH_SECRET: z.string().min(32).optional(),
    AGENT_KEY_ID: z.string().min(1).max(64),
    AGENT_PREVIOUS_KEY_ID: z.string().min(1).max(64).optional(),
    INTERNAL_STATUS_SECRET: z.string().min(32)
  })
  .superRefine((value, context) => {
    if (
      (value.AGENT_PREVIOUS_KEY_ID === undefined) !==
      (value.AGENT_PREVIOUS_AUTH_SECRET === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Previous agent key ID and secret must be configured together",
        path: ["AGENT_PREVIOUS_KEY_ID"]
      });
    }
    if (
      value.AGENT_PREVIOUS_KEY_ID !== undefined &&
      value.AGENT_PREVIOUS_KEY_ID === value.AGENT_KEY_ID
    ) {
      context.addIssue({
        code: "custom",
        message: "Current and previous agent key IDs must differ",
        path: ["AGENT_PREVIOUS_KEY_ID"]
      });
    }
    if (
      value.AGENT_PREVIOUS_AUTH_SECRET !== undefined &&
      value.AGENT_PREVIOUS_AUTH_SECRET === value.AGENT_AUTH_SECRET
    ) {
      context.addIssue({
        code: "custom",
        message: "Current and previous agent secrets must differ",
        path: ["AGENT_PREVIOUS_AUTH_SECRET"]
      });
    }
  });

export const voiceEnvironmentSchema = z
  .object({
    DEPLOYMENT_ID: z.string().min(1).max(64),
    TENANT_ID: z.string().min(1).max(64),
    DISCORD_BOT_TOKEN: z.string().min(32),
    AGENT_ENDPOINT: z.url().refine((url) => url.startsWith("wss://"), "Expected wss:// URL"),
    AGENT_AUTH_SECRET: z.string().min(32),
    AGENT_PREVIOUS_AUTH_SECRET: z.string().min(32).optional(),
    AGENT_KEY_ID: z.string().min(1).max(64),
    AGENT_PREVIOUS_KEY_ID: z.string().min(1).max(64).optional(),
    TARGET_APPROVER_USER_IDS: csvSnowflakes,
    PREFIX_COMMANDS_ENABLED: booleanString,
    MESSAGE_CONTENT_INTENT_ENABLED: booleanString,
    MANAGED_ROOMS_ENABLED: booleanString,
    MANAGED_GUILD_IDS: csvSnowflakes
  })
  .superRefine((value, context) => {
    if (value.PREFIX_COMMANDS_ENABLED && !value.MESSAGE_CONTENT_INTENT_ENABLED) {
      context.addIssue({
        code: "custom",
        message: "Prefix commands require MESSAGE_CONTENT_INTENT_ENABLED=true",
        path: ["PREFIX_COMMANDS_ENABLED"]
      });
    }
    if (
      (value.AGENT_PREVIOUS_KEY_ID === undefined) !==
      (value.AGENT_PREVIOUS_AUTH_SECRET === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Previous agent key ID and secret must be configured together",
        path: ["AGENT_PREVIOUS_KEY_ID"]
      });
    }
    if (
      value.AGENT_PREVIOUS_KEY_ID !== undefined &&
      value.AGENT_PREVIOUS_KEY_ID === value.AGENT_KEY_ID
    ) {
      context.addIssue({
        code: "custom",
        message: "Current and previous agent key IDs must differ",
        path: ["AGENT_PREVIOUS_KEY_ID"]
      });
    }
    if (
      value.AGENT_PREVIOUS_AUTH_SECRET !== undefined &&
      value.AGENT_PREVIOUS_AUTH_SECRET === value.AGENT_AUTH_SECRET
    ) {
      context.addIssue({
        code: "custom",
        message: "Current and previous agent secrets must differ",
        path: ["AGENT_PREVIOUS_AUTH_SECRET"]
      });
    }
  });

export const userRpcEnvironmentSchema = z
  .object({
    DEPLOYMENT_ID: z.string().min(1).max(64),
    TENANT_ID: z.string().min(1).max(64),
    USER_RPC_DISCORD_APPLICATION_ID: snowflakeSchema,
    USER_RPC_DISCORD_ACCESS_TOKEN: z.string().min(16),
    USER_RPC_ALLOWED_GUILD_ID: snowflakeSchema,
    USER_RPC_EXPECTED_USER_ID: snowflakeSchema,
    AGENT_ENDPOINT: z.url().refine((url) => url.startsWith("wss://"), "Expected wss:// URL"),
    AGENT_AUTH_SECRET: z.string().min(32),
    AGENT_PREVIOUS_AUTH_SECRET: z.string().min(32).optional(),
    AGENT_KEY_ID: z.string().min(1).max(64),
    AGENT_PREVIOUS_KEY_ID: z.string().min(1).max(64).optional()
  })
  .superRefine((value, context) => {
    if (
      (value.AGENT_PREVIOUS_KEY_ID === undefined) !==
      (value.AGENT_PREVIOUS_AUTH_SECRET === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Previous agent key ID and secret must be configured together",
        path: ["AGENT_PREVIOUS_KEY_ID"]
      });
    }
    if (
      value.AGENT_PREVIOUS_KEY_ID !== undefined &&
      value.AGENT_PREVIOUS_KEY_ID === value.AGENT_KEY_ID
    ) {
      context.addIssue({
        code: "custom",
        message: "Current and previous agent key IDs must differ",
        path: ["AGENT_PREVIOUS_KEY_ID"]
      });
    }
    if (
      value.AGENT_PREVIOUS_AUTH_SECRET !== undefined &&
      value.AGENT_PREVIOUS_AUTH_SECRET === value.AGENT_AUTH_SECRET
    ) {
      context.addIssue({
        code: "custom",
        message: "Current and previous agent secrets must differ",
        path: ["AGENT_PREVIOUS_AUTH_SECRET"]
      });
    }
  });

export const voiceHostModeSchema = z
  .object({
    HOST_ENABLED: booleanString,
    PROBE_ENABLED: booleanString,
    PROBE_GUILD_ID: optionalSnowflake,
    PROBE_VOICE_CHANNEL_ID: optionalSnowflake,
    PROBE_STABLE_MS: millisecondString.default(60_000)
  })
  .superRefine((value, context) => {
    if (value.HOST_ENABLED && value.PROBE_ENABLED) {
      context.addIssue({
        code: "custom",
        message: "Production host and voice probe cannot run concurrently",
        path: ["PROBE_ENABLED"]
      });
    }
    if (
      value.PROBE_ENABLED &&
      (value.PROBE_GUILD_ID === "" || value.PROBE_VOICE_CHANNEL_ID === "")
    ) {
      context.addIssue({
        code: "custom",
        message: "Enabled probe requires exact guild and voice channel IDs",
        path: ["PROBE_GUILD_ID"]
      });
    }
  });

export type ControlEnvironment = z.infer<typeof controlEnvironmentSchema>;
export type UserRpcEnvironment = z.infer<typeof userRpcEnvironmentSchema>;
export type VoiceEnvironment = z.infer<typeof voiceEnvironmentSchema>;
export type VoiceHostMode = z.infer<typeof voiceHostModeSchema>;
