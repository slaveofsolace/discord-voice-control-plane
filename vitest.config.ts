import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/**/*.test.ts",
      "apps/control-worker/src/**/*.test.ts",
      "apps/voice-agent/**/*.test.ts",
      "scripts/**/*.test.ts",
      "spikes/**/*.test.ts"
    ],
    coverage: {
      enabled: false
    }
  }
});
