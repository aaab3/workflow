/**
 * Smoke test: all 10 official default templates execute successfully.
 */

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import {
  WorkflowEngine,
  createDefaultRegistry,
  createDefaultSecurityConfig,
} from "@openclaw/workflow-engine";
import { DEFAULT_WORKFLOW_TEMPLATES } from "../src/seed/default-workflows.js";

describe("Default workflow templates", () => {
  it("should execute all 10 built-in templates", async () => {
    const workflowDir = await mkdtemp(join(tmpdir(), "wf-tpl-"));
    const registry = createDefaultRegistry();
    const engine = new WorkflowEngine(registry);
    const security = createDefaultSecurityConfig(workflowDir);

    for (const wf of DEFAULT_WORKFLOW_TEMPLATES) {
      const inputs =
        wf.id === "tpl-10-full-automation"
          ? { threshold: 50, items: [10, 20, 55, 70] }
          : undefined;

      const ctx = await engine.execute(wf, { security, inputs });
      expect(ctx.status, `${wf.id} should complete`).toBe("completed");
      expect(ctx.metrics.failedNodes, `${wf.id} should have no failures`).toBe(0);
    }
  }, 120_000);
});
