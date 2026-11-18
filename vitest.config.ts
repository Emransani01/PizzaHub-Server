import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    // One in-memory MongoDB instance is shared per Test Runner fork, and the
    // suites clear collections between cases, so files run sequentially.
    fileParallelism: false,
    pool: "forks",
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
