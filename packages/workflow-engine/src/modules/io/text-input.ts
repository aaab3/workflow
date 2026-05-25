/**
 * io-text-input module — User-defined text as a workflow source node.
 *
 * Use this instead of hacking LLM or terminal nodes when you only need
 * static or expression-resolved text to feed downstream steps.
 */

import { z } from "zod";
import type { ModuleHandler } from "../../types.js";

const configZod = z.object({
  content: z
    .string()
    .default("")
    .describe("文本内容（支持 {{input.xxx}}、{{vars.xxx}} 等表达式，可多行）"),
  label: z.string().optional().describe("备注（仅用于画布显示，不影响输出）"),
});

const inputsZod = z.object({
  content: z.string().optional().describe("上游传入时可覆盖配置中的文本"),
});

export const textInputModule: ModuleHandler = {
  meta: {
    id: "io-text-input",
    name: "文字输入",
    category: "io",
    description: "在节点中直接编写文本，作为下游节点的输入（无需 LLM 或终端）",
    icon: "text-cursor",
    inputs: [{ id: "content", name: "覆盖文本", type: "string", required: false }],
    outputs: [{ id: "text", name: "文本", type: "string" }],
    configSchema: {},
    version: "1.0.0",
  },

  configZod,
  inputsZod,

  async execute(
    inputs: Record<string, unknown>,
    config: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const cfg = configZod.parse(config);
    const ins = inputsZod.parse(inputs);
    const text = ins.content !== undefined && ins.content !== null && ins.content !== ""
      ? String(ins.content)
      : String(cfg.content ?? "");
    return { text, length: text.length };
  },
};
