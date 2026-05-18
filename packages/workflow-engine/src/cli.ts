#!/usr/bin/env node
/**
 * OpenClaw Workflow CLI
 *
 * Usage:
 *   openclaw-workflow run <workflow.json> [--input.key=value ...]
 *   openclaw-workflow validate <workflow.json>
 *   openclaw-workflow list [directory]
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { WorkflowEngine } from "./engine.js";
import { buildGraph, GraphValidationError } from "./graph.js";
import { createDefaultRegistry } from "./shared-registry.js";
import type { Workflow, EngineEvent } from "./types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

async function loadWorkflow(filePath: string): Promise<Workflow> {
  const absPath = resolve(filePath);
  const content = await readFile(absPath, "utf-8");
  try {
    return JSON.parse(content) as Workflow;
  } catch {
    throw new Error(`Failed to parse workflow JSON: ${absPath}`);
  }
}

function parseInputArgs(args: string[]): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (const arg of args) {
    if (arg.startsWith("--input.")) {
      const eqIndex = arg.indexOf("=");
      if (eqIndex === -1) continue;
      const key = arg.slice(8, eqIndex); // strip "--input."
      const value = arg.slice(eqIndex + 1);
      // Try to parse as JSON, fallback to string
      try {
        inputs[key] = JSON.parse(value);
      } catch {
        inputs[key] = value;
      }
    }
  }
  return inputs;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function logEvent(event: EngineEvent): void {
  const time = new Date().toISOString().slice(11, 23);
  switch (event.type) {
    case "execution:start":
      console.log(`[${time}] ▶ Execution started (${event.executionId})`);
      break;
    case "node:start":
      console.log(`[${time}] ● Running: ${event.nodeId}`);
      break;
    case "node:complete":
      console.log(`[${time}] ✓ Completed: ${event.nodeId} (${formatDuration(event.duration)})`);
      break;
    case "node:error":
      const retry = event.willRetry ? " (will retry)" : "";
      console.log(`[${time}] ✗ Error: ${event.nodeId} - ${event.error.message}${retry}`);
      break;
    case "node:skip":
      console.log(`[${time}] ○ Skipped: ${event.nodeId} (${event.reason})`);
      break;
    case "execution:complete":
      console.log(`[${time}] ✔ Execution completed in ${formatDuration(event.duration)}`);
      console.log(`  Nodes: ${event.metrics.completedNodes} completed, ${event.metrics.failedNodes} failed, ${event.metrics.skippedNodes} skipped`);
      break;
    case "execution:error":
      console.error(`[${time}] ✗ Execution failed: ${event.message}`);
      break;
  }
}

// ─── Commands ───────────────────────────────────────────────────────────────

async function runCommand(filePath: string, args: string[]): Promise<void> {
  const workflow = await loadWorkflow(filePath);
  const inputs = parseInputArgs(args);
  const registry = createDefaultRegistry();
  const engine = new WorkflowEngine(registry);

  engine.on(logEvent);

  console.log(`\nRunning workflow: ${workflow.name} (v${workflow.version})`);
  if (Object.keys(inputs).length > 0) {
    console.log(`Inputs: ${JSON.stringify(inputs)}`);
  }
  console.log("");

  const context = await engine.execute(workflow, { inputs });

  console.log("");
  if (context.status === "completed") {
    // Print final outputs
    const terminalOutputs: Record<string, unknown> = {};
    for (const [nodeId, state] of context.nodeStates) {
      if (state.status === "completed" && state.output !== undefined) {
        terminalOutputs[nodeId] = state.output;
      }
    }
    console.log("Outputs:", JSON.stringify(terminalOutputs, null, 2));
    process.exitCode = 0;
  } else {
    console.error(`Workflow ended with status: ${context.status}`);
    if (context.errors.length > 0) {
      console.error("\nErrors:");
      for (const err of context.errors) {
        console.error(`  [${err.nodeId}] ${err.message}`);
      }
    }
    process.exitCode = 1;
  }
}

async function validateCommand(filePath: string): Promise<void> {
  const workflow = await loadWorkflow(filePath);

  console.log(`Validating: ${workflow.name} (v${workflow.version})`);
  console.log(`  Nodes: ${workflow.nodes.length}`);
  console.log(`  Edges: ${workflow.edges.length}`);

  try {
    const graph = buildGraph(workflow);
    console.log(`  Entry nodes: ${graph.entryNodes.join(", ")}`);
    console.log(`  Execution order: ${graph.sortedIds.join(" → ")}`);

    // Check module availability
    const registry = createDefaultRegistry();
    const missingModules: string[] = [];
    for (const node of workflow.nodes) {
      if (!registry.has(node.type)) {
        missingModules.push(`${node.id} (${node.type})`);
      }
    }

    if (missingModules.length > 0) {
      console.warn(`\n⚠ Missing modules:`);
      for (const m of missingModules) {
        console.warn(`    ${m}`);
      }
    }

    console.log("\n✓ Workflow structure is valid");
    process.exitCode = 0;
  } catch (error) {
    if (error instanceof GraphValidationError) {
      console.error(`\n✗ Validation failed: ${error.message}`);
      for (const detail of error.details) {
        console.error(`  ${detail.nodeId ? `[${detail.nodeId}] ` : ""}${detail.message}`);
      }
    } else {
      console.error(`\n✗ Validation failed: ${error instanceof Error ? error.message : error}`);
    }
    process.exitCode = 1;
  }
}

async function listCommand(directory: string): Promise<void> {
  const dir = resolve(directory);
  const entries = await readdir(dir);

  console.log(`Workflows in: ${dir}\n`);

  let count = 0;
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const filePath = resolve(dir, entry);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) continue;

    try {
      const content = await readFile(filePath, "utf-8");
      const wf = JSON.parse(content) as Workflow;
      console.log(`  ${basename(entry, ".json")}`);
      console.log(`    Name: ${wf.name}`);
      console.log(`    Version: ${wf.version}`);
      console.log(`    Nodes: ${wf.nodes.length}`);
      if (wf.description) {
        console.log(`    Description: ${wf.description}`);
      }
      console.log("");
      count++;
    } catch {
      // Skip invalid JSON files
    }
  }

  if (count === 0) {
    console.log("  (no workflows found)");
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    console.log(`
OpenClaw Workflow CLI

Usage:
  openclaw-workflow run <workflow.json> [--input.key=value ...]
  openclaw-workflow validate <workflow.json>
  openclaw-workflow list [directory]

Commands:
  run        Execute a workflow
  validate   Validate workflow structure
  list       List workflows in a directory

Options:
  --input.key=value   Pass input parameters to the workflow
  --help, -h          Show this help message
`);
    return;
  }

  try {
    switch (command) {
      case "run": {
        const filePath = args[1];
        if (!filePath) {
          console.error("Error: workflow file path is required");
          process.exitCode = 1;
          return;
        }
        await runCommand(filePath, args.slice(2));
        break;
      }
      case "validate": {
        const filePath = args[1];
        if (!filePath) {
          console.error("Error: workflow file path is required");
          process.exitCode = 1;
          return;
        }
        await validateCommand(filePath);
        break;
      }
      case "list": {
        const dir = args[1] ?? "./workflows";
        await listCommand(dir);
        break;
      }
      default:
        console.error(`Unknown command: ${command}`);
        console.error('Run "openclaw-workflow --help" for usage');
        process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}

main();
