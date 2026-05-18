import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for OpenClaw Workflow E2E tests.
 *
 * Uses system-installed Microsoft Edge (channel: "msedge") to avoid
 * downloading Chromium. Backend and frontend are auto-started via webServer.
 *
 * Ports:
 * - 3199: backend (test isolation, not the default 3100)
 * - 3299: frontend (test isolation, not the default 3200)
 */

const BACKEND_PORT = 3199;
const FRONTEND_PORT = 3299;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,           // Tests share a single backend; run serial
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,                     // Single worker — backend has shared state
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: `http://127.0.0.1:${FRONTEND_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 10000,
  },

  projects: [
    {
      name: "edge",
      use: {
        ...devices["Desktop Edge"],
        channel: "msedge",
      },
    },
  ],

  webServer: [
    {
      command: `pnpm --filter @openclaw/workflow-server start`,
      cwd: ".",
      port: BACKEND_PORT,
      env: {
        // Custom env for the test backend
        WORKFLOWS_DIR: "./e2e/.test-workflows",
        PORT: String(BACKEND_PORT),
      },
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `pnpm --filter @openclaw/workflow-ui exec vite --port ${FRONTEND_PORT} --strictPort`,
      cwd: ".",
      port: FRONTEND_PORT,
      env: {
        // Make Vite proxy point to the test backend
        VITE_API_PORT: String(BACKEND_PORT),
      },
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
