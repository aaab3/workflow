/**
 * flow-condition module - Conditional branching (if/else).
 *
 * Evaluates a condition expression and routes the input to the "true" or
 * "false" output port based on the chosen operator.
 */

import { z } from "zod";
import type { ModuleHandler, ExecutionContext } from "../../types.js";

const OPERATORS = [
  "==", "!=", ">", "<", ">=", "<=",
  "contains", "startsWith", "endsWith",
  "empty", "notEmpty", "truthy", "falsy",
] as const;

const configZod = z.object({
  operator: z.enum(OPERATORS).default("truthy").describe("比较运算符"),
  compareValue: z.unknown().optional().describe("比较目标值（==, !=, >, <, contains, startsWith, endsWith 时使用）"),
});

const inputsZod = z.object({
  value: z.unknown().describe("待判断的值"),
});

type Config = z.infer<typeof configZod>;

export const conditionModule: ModuleHandler = {
  meta: {
    id: "flow-condition",
    name: "条件分支",
    category: "flow",
    description: "根据条件运算符判断输入值，路由到 true/false 输出端口",
    icon: "git-branch",
    inputs: [{ id: "value", name: "判断值", type: "any" }],
    outputs: [
      { id: "true", name: "条件为真", type: "any" },
      { id: "false", name: "条件为假", type: "any" },
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
    const { value } = inputsZod.parse(inputs);
    const { operator, compareValue } = configZod.parse(config);

    const result = evaluateCondition(value, operator, compareValue);

    return {
      true: result ? value : undefined,
      false: result ? undefined : value,
      result,
    };
  },
};

function evaluateCondition(value: unknown, operator: Config["operator"], compareValue: unknown): boolean {
  switch (operator) {
    case "==": return value == compareValue;
    case "!=": return value != compareValue;
    case ">":  return Number(value) >  Number(compareValue);
    case "<":  return Number(value) <  Number(compareValue);
    case ">=": return Number(value) >= Number(compareValue);
    case "<=": return Number(value) <= Number(compareValue);
    case "contains":   return String(value).includes(String(compareValue));
    case "startsWith": return String(value).startsWith(String(compareValue));
    case "endsWith":   return String(value).endsWith(String(compareValue));
    case "empty":
      return value === null || value === undefined || value === "" ||
             (Array.isArray(value) && value.length === 0);
    case "notEmpty":
      return value !== null && value !== undefined && value !== "" &&
             !(Array.isArray(value) && value.length === 0);
    case "truthy": return Boolean(value);
    case "falsy":  return !value;
    default: return Boolean(value);
  }
}
