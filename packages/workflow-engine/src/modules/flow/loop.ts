/**
 * flow-loop module — Iterate over an array, executing a sub-command for each item.
 *
 * Two modes:
 * - forEach: iterate over an array, run an expression for each item
 * - while: repeat while a condition is true (with maxIterations safety)
 *
 * Note: expressions use `new Function()` for evaluation. This is documented
 * as a known security limitation — only use with trusted workflow authors.
 * Integration with the proper code sandbox is a future improvement.
 */

import { z } from "zod";
import type { ModuleHandler, ExecutionContext } from "../../types.js";

const configZod = z.object({
  mode: z.enum(["forEach", "while"]).default("forEach")
    .describe("循环模式：forEach=遍历数组，while=条件循环"),
  expression: z.string().optional()
    .describe("对每个元素执行的 JS 表达式（forEach: item, index, items；while: counter, results, inputs）"),
  condition: z.string().optional()
    .describe("继续循环的条件表达式（while 模式必填）"),
  maxIterations: z.number().int().min(1).max(100000).default(1000)
    .describe("最大迭代次数（安全阀）"),
}).refine(
  (cfg) => cfg.mode === "forEach" || (cfg.condition && cfg.condition.length > 0),
  { message: "while mode requires a `condition` expression", path: ["condition"] }
);

const inputsZod = z.object({
  items: z.array(z.unknown()).optional(),
});

type Config = z.infer<typeof configZod>;
type Inputs = z.infer<typeof inputsZod>;

export const loopModule: ModuleHandler = {
  meta: {
    id: "flow-loop",
    name: "循环",
    category: "flow",
    description: "遍历数组（forEach）或重复执行（while）",
    icon: "repeat",
    inputs: [{ id: "items", name: "数组数据", type: "array" }],
    outputs: [
      { id: "results", name: "处理结果", type: "array" },
      { id: "count", name: "处理数量", type: "number" },
    ],
    configSchema: {}, // Auto-derived
    version: "2.0.0",
  },

  configZod,
  inputsZod,

  async execute(
    inputs: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext
  ): Promise<Record<string, unknown>> {
    const cfg = configZod.parse(config);
    const ins = inputsZod.parse(inputs);

    if (cfg.mode === "forEach") {
      return executeForEach(ins, cfg);
    }
    return executeWhile(ins, cfg);
  },
};

function executeForEach(inputs: Inputs, config: Config): Record<string, unknown> {
  const items = inputs.items;
  if (!Array.isArray(items)) {
    throw new Error("forEach mode requires `items` input to be an array");
  }
  const expression = config.expression ?? "item";
  const limit = Math.min(items.length, config.maxIterations);
  const results: unknown[] = [];

  for (let index = 0; index < limit; index++) {
    const item = items[index];
    try {
      const fn = new Function("item", "index", "items", `return (${expression});`);
      results.push(fn(item, index, items));
    } catch (error) {
      results.push({ error: error instanceof Error ? error.message : String(error), index });
    }
  }

  return { results, count: results.length };
}

function executeWhile(inputs: Inputs, config: Config): Record<string, unknown> {
  const condition = config.condition!; // Validated by zod refine
  const expression = config.expression ?? "counter";
  const results: unknown[] = [];
  let counter = 0;

  while (counter < config.maxIterations) {
    try {
      const condFn = new Function("counter", "results", "inputs", `return Boolean(${condition});`);
      if (!condFn(counter, results, inputs)) break;
    } catch {
      break;
    }

    try {
      const exprFn = new Function("counter", "results", "inputs", `return (${expression});`);
      results.push(exprFn(counter, results, inputs));
    } catch (error) {
      results.push({ error: error instanceof Error ? error.message : String(error) });
      break;
    }
    counter++;
  }

  return { results, count: counter };
}
