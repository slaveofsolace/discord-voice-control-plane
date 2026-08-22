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

export const controlEnvironmentSchema = z.object({
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
    MANAGED_ROOMS_ENABLED: booleanString
  })
  .superRefine((value, context) => {
    if (value.PREFIX_COMMANDS_ENABLED && !value.MESSAGE_CONTENT_INTENT_ENABLED) {
      context.addIssue({
        code: "custom",
        message: "Prefix commands require MESSAGE_CONTENT_INTENT_ENABLED=true",
        path: ["PREFIX_COMMANDS_ENABLED"]
      });
    }
  });

export type ControlEnvironment = z.infer<typeof controlEnvironmentSchema>;
export type VoiceEnvironment = z.infer<typeof voiceEnvironmentSchema>;
