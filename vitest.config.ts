import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Pipeline tests spawn git + node subprocesses per task workspace.
    testTimeout: 120_000,
  },
});
