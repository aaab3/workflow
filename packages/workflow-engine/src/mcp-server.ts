#!/usr/bin/env node
/**
 * OpenClaw Workflow MCP Server
 *
 * Exposes workflow capabilities as MCP tools so any AI Agent
 * (Claude, ChatGPT, Cursor, etc.) can discover and execute workflows.
 *
 * Tools exposed:
 * - list_workflows: List all available workflows
 * - get_workflow: Get workflow details
 * - run_workflow: Execute a workflow with inputs
 * - validate_workflow: Validate workflow structure
 * - list_modules: List available node modules
 *
 * Usage:
 *   node mcp-server.js [--workflows-dir ./workflows]
 *
 * Configure in Claude/Cursor MCP settings:
 *   {
 *     "mcpServers": {
 *       "openclaw-workflow": {
 *         "command": "node",
 *         "args": ["path/to/packages/workflow-engine/dist/mcp-server.js"],
 *         "env": { "WORKFLOWS_DIR": "./workflows" }
 *       }
 *     }
 *   }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { WorkflowEngine } from "./engine.js";
import { ModuleRegistry } from "./module-registry.js";
import { buildGraph, GraphValidationError } from "./graph.js";
import { fileReadModule, fileWriteModule, httpRequestModule, terminalModule } from "./modules/io/index.js";
import { javascriptModule } from "./modules/code/index.js";
import { conditionModule, delayModule } from "./modules/flow/index.js";
import { llmChatModule } from "./modules/llm/index.js";
import type { Workflow } from "./types.js";

// ─── Setup ──────────────────────────────────────────────────────────────────

const WORKFLOWS_DIR = resolve(process.env.WORKFLOWS_DIR ?? process.argv[2] ?? "./workflows");

function createRegistry(): ModuleRegistry {
  const registry = new ModuleRegistry();
  registry.register(fileReadModule);
  registry.register(fileWriteModule);
  registry.register(httpRequestModule);
  registry.register(terminalModule);
  registry.register(javascriptModule);
  registry.register(conditionModule);
  registry.register(delayModule);
  registry.register(llmChatModule);
  return registry;
}

async function loadWorkflow(idOrPath: string): Promise<Workflow> {
  // Try as absolute/relative path first
  let filePath = idOrPath;
  if (!filePath.endsWith(".json")) {
    filePath = join(WORKFLOWS_DIR, `${idOrPath}.json`);
  }
  const absPath = resolve(filePath);
  const content = await readFile(absPath, "utf-8");
  return JSON.parse(content) as Workflow;
}

async function listWorkflowFiles(): Promise<Array<{ id: string; name: string; path: string; description?: string; nodeCount: number }>> {
  try {
    await mkdir(WORKFLOWS_DIR, { recursive: true });
    const files = await readdir(WORKFLOWS_DIR, { recursive: true });
    const workflows: Array<{ id: string; name: string; path: string; description?: string; nodeCount: number }> = [];

    for (const file of files) {
      if (!String(file).endsWith(".json")) continue;
      try {
        const filePath = join(WORKFLOWS_DIR, String(file));
        const content = await readFile(filePath, "utf-8");
        const wf = JSON.parse(content) as Workflow;
        workflows.push({
          id: wf.id,
          name: wf.name,
          path: filePath,
          description: wf.description,
          nodeCount: wf.nodes.length,
        });
      } catch {
        // Skip invalid files
      }
    }
    return workflows;
  } catch {
    return [];
  }
}

// ─── MCP Server ─────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "openclaw-workflow",
  version: "0.1.0",
});

// Tool: list_workflows
server.tool(
  "list_workflows",
  "List all available workflows in the workflows directory",
  {},
  async () => {
    const workflows = await listWorkflowFiles();
    if (workflows.length === 0) {
      return { content: [{ type: "text", text: `No workflows found in ${WORKFLOWS_DIR}` }] };
    }
    const list = workflows.map((w) =>
      `- **${w.name}** (${w.id})\n  ${w.description ?? "No description"}\n  Nodes: ${w.nodeCount}`
    ).join("\n\n");
    return { content: [{ type: "text", text: `Found ${workflows.length} workflows:\n\n${list}` }] };
  }
);

// Tool: run_workflow
server.tool(
  "run_workflow",
  "Execute a workflow by ID or file path. Returns the execution results.",
  {
    workflow: z.string().describe("Workflow ID or file path (e.g. 'hello-world' or './workflows/my-flow.json')"),
    inputs: z.record(z.unknown()).optional().describe("Input parameters as key-value pairs"),
  },
  async ({ workflow: workflowId, inputs }) => {
    try {
      const wf = await loadWorkflow(workflowId);
      const registry = createRegistry();
      const engine = new WorkflowEngine(registry);

      const context = await engine.execute(wf, { inputs: inputs ?? {} });

      // Collect outputs
      const outputs: Record<string, unknown> = {};
      for (const [nodeId, state] of context.nodeStates) {
        if (state.status === "completed" && state.output !== undefined) {
          outputs[nodeId] = state.output;
        }
      }

      const statusEmoji = context.status === "completed" ? "✅" : "❌";
      const summary = [
        `${statusEmoji} Workflow "${wf.name}" ${context.status}`,
        `Duration: ${context.metrics.totalDuration}ms`,
        `Nodes: ${context.metrics.completedNodes} completed, ${context.metrics.failedNodes} failed, ${context.metrics.skippedNodes} skipped`,
      ].join("\n");

      let resultText = summary;

      if (Object.keys(outputs).length > 0) {
        resultText += `\n\nOutputs:\n${JSON.stringify(outputs, null, 2)}`;
      }

      if (context.errors.length > 0) {
        resultText += `\n\nErrors:\n${context.errors.map((e) => `[${e.nodeId}] ${e.message}`).join("\n")}`;
      }

      return { content: [{ type: "text", text: resultText }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

// Tool: validate_workflow
server.tool(
  "validate_workflow",
  "Validate a workflow's structure (check for cycles, missing nodes, type errors)",
  {
    workflow: z.string().describe("Workflow ID or file path"),
  },
  async ({ workflow: workflowId }) => {
    try {
      const wf = await loadWorkflow(workflowId);
      const graph = buildGraph(wf);
      const registry = createRegistry();

      // Check for missing modules
      const missingModules = wf.nodes
        .filter((n) => !registry.has(n.type))
        .map((n) => `${n.id} (${n.type})`);

      let text = `✅ Workflow "${wf.name}" is valid\n`;
      text += `Entry nodes: ${graph.entryNodes.join(", ")}\n`;
      text += `Execution order: ${graph.sortedIds.join(" → ")}`;

      if (missingModules.length > 0) {
        text += `\n\n⚠️ Missing modules:\n${missingModules.map((m) => `  - ${m}`).join("\n")}`;
      }

      return { content: [{ type: "text", text }] };
    } catch (error) {
      if (error instanceof GraphValidationError) {
        const details = error.details.map((d) => `  - ${d.nodeId ? `[${d.nodeId}] ` : ""}${d.message}`).join("\n");
        return { content: [{ type: "text", text: `❌ Validation failed: ${error.message}\n${details}` }], isError: true };
      }
      return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

// Tool: get_workflow
server.tool(
  "get_workflow",
  "Get the full JSON definition of a workflow",
  {
    workflow: z.string().describe("Workflow ID or file path"),
  },
  async ({ workflow: workflowId }) => {
    try {
      const wf = await loadWorkflow(workflowId);
      return { content: [{ type: "text", text: JSON.stringify(wf, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

// Tool: create_workflow
server.tool(
  "create_workflow",
  "Create a new workflow from a JSON definition and save it to the workflows directory",
  {
    definition: z.string().describe("Complete workflow JSON definition"),
    filename: z.string().optional().describe("Filename (without .json extension). Defaults to workflow ID"),
  },
  async ({ definition, filename }) => {
    try {
      const wf = JSON.parse(definition) as Workflow;

      // Validate
      buildGraph(wf);

      // Save
      await mkdir(WORKFLOWS_DIR, { recursive: true });
      const fname = filename ?? wf.id ?? `workflow-${Date.now()}`;
      const filePath = join(WORKFLOWS_DIR, `${fname}.json`);
      await writeFile(filePath, JSON.stringify(wf, null, 2), "utf-8");

      return { content: [{ type: "text", text: `✅ Workflow "${wf.name}" saved to ${filePath}` }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

// Tool: list_modules
server.tool(
  "list_modules",
  "List all available workflow node modules with their inputs, outputs, and configuration",
  {},
  async () => {
    const registry = createRegistry();
    const modules = registry.listMeta();

    const text = modules.map((m) => {
      const inputs = m.inputs.map((p) => `${p.name} (${p.type})`).join(", ") || "none";
      const outputs = m.outputs.map((p) => `${p.name} (${p.type})`).join(", ") || "none";
      return `### ${m.name} (\`${m.id}\`)\n${m.description}\n- Category: ${m.category}\n- Inputs: ${inputs}\n- Outputs: ${outputs}`;
    }).join("\n\n");

    return { content: [{ type: "text", text: `Available modules (${modules.length}):\n\n${text}` }] };
  }
);

// ─── Start ──────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("MCP Server error:", error);
  process.exit(1);
});
