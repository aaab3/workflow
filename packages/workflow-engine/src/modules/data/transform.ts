/**
 * data-transform module — Transform data without writing code.
 *
 * Operations: pick fields, rename, filter array, map array, flatten, merge, sort.
 */

import type { ModuleHandler, ExecutionContext } from "../../types.js";

export const dataTransformModule: ModuleHandler = {
  meta: {
    id: "data-transform",
    name: "数据转换",
    category: "data",
    description: "无代码数据转换：提取字段、重命名、过滤、映射、排序等",
    icon: "shuffle",
    inputs: [
      { id: "data", name: "输入数据", type: "any" },
    ],
    outputs: [
      { id: "result", name: "转换结果", type: "any" },
    ],
    configSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["pick", "rename", "filter", "map", "flatten", "sort", "group", "unique", "count", "join", "split"],
          default: "pick",
          description: "操作类型",
        },
        fields: {
          type: "string",
          description: "字段列表（逗号分隔）— 用于 pick/rename",
        },
        expression: {
          type: "string",
          description: "表达式 — 用于 filter/map/sort 的条件",
        },
        separator: {
          type: "string",
          default: ",",
          description: "分隔符 — 用于 join/split",
        },
        renameMap: {
          type: "string",
          description: "重命名映射 JSON — 如 {\"old\":\"new\"}",
        },
      },
      required: ["operation"],
    },
  },

  async execute(
    inputs: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext
  ): Promise<Record<string, unknown>> {
    const data = inputs.data;
    const operation = config.operation as string;

    switch (operation) {
      case "pick":
        return { result: pickFields(data, config.fields as string) };
      case "rename":
        return { result: renameFields(data, config.renameMap as string) };
      case "filter":
        return { result: filterArray(data, config.expression as string) };
      case "map":
        return { result: mapArray(data, config.expression as string) };
      case "flatten":
        return { result: Array.isArray(data) ? data.flat() : data };
      case "sort":
        return { result: sortArray(data, config.expression as string) };
      case "group":
        return { result: groupBy(data, config.fields as string) };
      case "unique":
        return { result: Array.isArray(data) ? [...new Set(data)] : data };
      case "count":
        return { result: Array.isArray(data) ? data.length : typeof data === "string" ? data.length : 0 };
      case "join":
        return { result: Array.isArray(data) ? data.join(config.separator as string ?? ",") : String(data) };
      case "split":
        return { result: typeof data === "string" ? data.split(config.separator as string ?? ",") : data };
      default:
        return { result: data };
    }
  },
};

function pickFields(data: unknown, fields: string | undefined): unknown {
  if (!fields || typeof data !== "object" || data === null) return data;
  const keys = fields.split(",").map((k) => k.trim());
  if (Array.isArray(data)) {
    return data.map((item) => pickFromObject(item as Record<string, unknown>, keys));
  }
  return pickFromObject(data as Record<string, unknown>, keys);
}

function pickFromObject(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in obj) result[key] = obj[key];
  }
  return result;
}

function renameFields(data: unknown, renameMap: string | undefined): unknown {
  if (!renameMap || typeof data !== "object" || data === null) return data;
  let map: Record<string, string>;
  try { map = JSON.parse(renameMap); } catch { return data; }

  const rename = (obj: Record<string, unknown>) => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[map[key] ?? key] = value;
    }
    return result;
  };

  if (Array.isArray(data)) return data.map((item) => rename(item as Record<string, unknown>));
  return rename(data as Record<string, unknown>);
}

function filterArray(data: unknown, expression: string | undefined): unknown {
  if (!Array.isArray(data) || !expression) return data;
  try {
    const fn = new Function("item", "index", `return Boolean(${expression});`);
    return data.filter((item, index) => fn(item, index));
  } catch { return data; }
}

function mapArray(data: unknown, expression: string | undefined): unknown {
  if (!Array.isArray(data) || !expression) return data;
  try {
    const fn = new Function("item", "index", `return (${expression});`);
    return data.map((item, index) => fn(item, index));
  } catch { return data; }
}

function sortArray(data: unknown, expression: string | undefined): unknown {
  if (!Array.isArray(data)) return data;
  const arr = [...data];
  if (!expression) return arr.sort();
  try {
    const fn = new Function("a", "b", `return (${expression});`);
    return arr.sort((a, b) => fn(a, b));
  } catch { return arr.sort(); }
}

function groupBy(data: unknown, field: string | undefined): unknown {
  if (!Array.isArray(data) || !field) return data;
  const key = field.trim();
  const groups: Record<string, unknown[]> = {};
  for (const item of data) {
    const val = String((item as Record<string, unknown>)[key] ?? "undefined");
    if (!groups[val]) groups[val] = [];
    groups[val]!.push(item);
  }
  return groups;
}
