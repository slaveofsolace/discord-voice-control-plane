import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations(fileURLToPath(new URL("./migrations", import.meta.url)));

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          AGENT_AUTH_SECRET: "test-agent-secret-with-at-least-32-bytes",
          CONTROL_RELAY_ENABLED: "true",
          CONTROL_RELAY_APPLICATION_ID: "100000000000000001",
          CONTROL_RELAY_CHANNEL_ID: "100000000000000003",
          CONTROL_OPERATOR_USER_IDS: "100000000000000004,100000000000000005",
          INTERNAL_STATUS_SECRET: "test-status-secret-with-at-least-32-bytes",
          RELAY_INGRESS_HMAC_SECRET: "test-relay-secret-with-at-least-32-bytes",
          TEST_MIGRATIONS: migrations
        }
      }
    })
  ],
  test: {
    include: ["test/**/*.test.ts"]
  }
});
