import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["shared/test/**/*.test.ts", "server/test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    environment: "node",
    env: { LOG_LEVEL: "silent" },
    // Server tests share one port; run files one at a time.
    fileParallelism: false,
  },
});
