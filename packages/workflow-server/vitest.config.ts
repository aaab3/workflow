import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    passWithNoTests: false,
    // Run test files sequentially — Fastify server instances and ports
    // can conflict if run in parallel
    fileParallelism: false,
    // Increase timeout for tests that involve real HTTP/WebSocket
    testTimeout: 15000,
  },
});
