#!/usr/bin/env node
/**
 * Run all default workflow templates and print a summary report.
 *
 * Usage: node scripts/test-default-workflows.mjs
 *        pnpm test:templates
 */

import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  WorkflowEngine,
  createDefaultRegistry,
  createDefaultSecurityConfig,
  buildGraph,
} from "../packages/workflow-engine/dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WORKFLOW_DIR = join(ROOT, "workflows");

/** Inline template IDs — must match seed/default-workflows.ts */
const TEMPLATE_IDS = [
  "tpl-01-data-pipeline",
  "tpl-02-condition-router",
  "tpl-03-loop-batch",
  "tpl-04-parallel-merge",
  "tpl-05-http-fetch",
  "tpl-06-file-etl",
  "tpl-07-error-continue",
  "tpl-08-js-chain",
  "tpl-09-cache-layer",
  "tpl-10-full-automation",
];

async function loadTemplatesFromWorkflowDir() {
  const { readFile, readdir } = await import("node:fs/promises");
  const files = await readdir(WORKFLOW_DIR).catch(() => []);
  const templates = [];
  for (const file of files) {
    if (!file.startsWith("tpl-") || !file.endsWith(".json")) continue;
    const wf = JSON.parse(await readFile(join(WORKFLOW_DIR, file), "utf-8"));
    templates.push(wf);
  }
  if (templates.length > 0) return templates;

  // Fallback: import from compiled server seed (after build)
  const seedPath = pathToFileURL(
    join(ROOT, "packages/workflow-server/dist/seed/default-workflows.js")
  ).href;
  const { DEFAULT_WORKFLOW_TEMPLATES } = await import(seedPath);
  return DEFAULT_WORKFLOW_TEMPLATES;
}

async function main() {
  await mkdir(WORKFLOW_DIR, { recursive: true });
  await mkdir(join(WORKFLOW_DIR, "seed-data"), { recursive: true });

  const registry = createDefaultRegistry();
  const engine = new WorkflowEngine(registry);
  const security = createDefaultSecurityConfig(WORKFLOW_DIR);

  let templates = await loadTemplatesFromWorkflowDir();
  if (templates.length === 0) {
    console.error("No templates found. Run: pnpm seed:templates && pnpm --filter @openclaw/workflow-server build");
    process.exit(1);
  }

  // Sort by id
  templates = templates.sort((a, b) => a.id.localeCompare(b.id));

  const results = [];
  console.log("\n=== Default Workflow Test Report ===\n");

  for (const wf of templates) {
    const row = { id: wf.id, name: wf.name, status: "?", nodes: wf.nodes.length, error: null, duration: 0 };
    try {
      buildGraph(wf);
      const inputs =
        wf.id === "tpl-10-full-automation"
          ? { threshold: 50, items: [10, 20, 30, 55, 70] }
          : undefined;
      const ctx = await engine.execute(wf, { security, inputs });
      row.status = ctx.status;
      row.duration = ctx.metrics.totalDuration ?? 0;
      row.completed = ctx.metrics.completedNodes;
      row.failed = ctx.metrics.failedNodes;
      row.skipped = ctx.metrics.skippedNodes;
      if (ctx.errors.length > 0) {
        row.error = ctx.errors[0].message;
      }
    } catch (err) {
      row.status = "error";
      row.error = err instanceof Error ? err.message : String(err);
    }
    results.push(row);

    const icon = row.status === "completed" ? "✓" : "✗";
    console.log(
      `${icon} ${row.id.padEnd(28)} ${row.status.padEnd(10)} ${String(row.duration).padStart(6)}ms  nodes:${row.nodes}` +
        (row.error ? `\n    └─ ${row.error}` : "")
    );
  }

  const passed = results.filter((r) => r.status === "completed").length;
  const failed = results.length - passed;

  console.log(`\n--- Summary: ${passed}/${results.length} passed, ${failed} failed ---\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
