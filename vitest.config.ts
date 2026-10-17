import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["shared/test/**/*.test.ts", "server/test/**/*.test.ts"],
    environment: "node",
    testTimeout: 20_000,
    env: { LOG_LEVEL: "silent" },
    // Server tests share one port; run files one at a time.
    fileParallelism: false,
  },
});
