/**
 * flow-delay module — Wait for a specified duration.
 *
 * Demonstrates the new Zod-based module pattern:
 * - configZod is the single source of truth for runtime validation + UI form
 * - Engine auto-derives JSON Schema from Zod for SchemaForm rendering
 * - Defaults are applied automatically by Zod's safeParse
 */

import { z } from "zod";
import type { ModuleHandler, ExecutionContext } from "../../types.js";

const configZod = z.object({
  duration: z
    .number()
    .int()
    .min(0)
    .max(3600000)
    .default(1000)
    .describe("等待时间（毫秒），最大 1 小时"),
});

const inputsZod = z.object({
  passthrough: z.unknown().optional(),
});

type Config = z.infer<typeof configZod>;
type Inputs = z.infer<typeof inputsZod>;

export const delayModule: ModuleHandler = {
  meta: {
    id: "flow-delay",
    name: "延时等待",
    category: "flow",
    description: "暂停执行指定时间",
    icon: "clock",
    inputs: [{ id: "passthrough", name: "透传数据", type: "any" }],
    outputs: [
      { id: "passthrough", name: "透传数据", type: "any" },
      { id: "waited", name: "等待时间(ms)", type: "number" },
    ],
    // configSchema is auto-derived from configZod by ModuleRegistry.register()
    configSchema: {},
    version: "2.0.0",
  },

  configZod,
  inputsZod,

  async execute(
    inputs: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext
  ): Promise<Record<string, unknown>> {
    const { duration } = configZod.parse(config);
    const { passthrough } = inputsZod.parse(inputs);

    await new Promise((resolve) => setTimeout(resolve, duration));

    return {
      passthrough,
      waited: duration,
    };
  },
};
