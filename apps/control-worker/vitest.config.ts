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
          INTERNAL_STATUS_SECRET: "test-status-secret-with-at-least-32-bytes",
          TEST_MIGRATIONS: migrations
        }
      }
    })
  ],
  test: {
    include: ["test/**/*.test.ts"]
  }
});
