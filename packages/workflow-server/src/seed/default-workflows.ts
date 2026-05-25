/**
 * Official default workflow templates — seeded into workflowDir on server start.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Workflow, PortDef } from "@openclaw/workflow-engine";
import type { FileWorkflowStorage } from "../storage/file-storage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const TEMPLATES_DIR = join(__dirname, "templates");

const DEFAULT_SETTINGS: Workflow["settings"] = {
  maxExecutionTime: 120000,
  maxNodeRetries: 0,
  errorStrategy: "fail-fast",
  concurrencyLimit: 10,
};

const TS = "2026-01-01T00:00:00.000Z";

function node(
  id: string,
  type: string,
  label: string,
  x: number,
  y: number,
  config: Record<string, unknown> = {},
  inputs: PortDef[] = [],
  outputs: PortDef[] = []
): Workflow["nodes"][0] {
  return {
    id,
    type,
    position: { x, y },
    data: { label, config, inputs, outputs },
  };
}

function edge(
  id: string,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string
): Workflow["edges"][0] {
  return { id, source, sourceHandle, target, targetHandle };
}

/** 10 complex official templates */
export const DEFAULT_WORKFLOW_TEMPLATES: Workflow[] = [
  // 1. Data pipeline
  {
    id: "tpl-01-data-pipeline",
    name: "数据处理流水线",
    description: "【官方模板】JS 生成用户列表 → 过滤 → 统计 → 汇总报告",
    version: "1.0.0",
    nodes: [
      node("gen", "code-javascript", "生成用户数据", 0, 120, {
        code: `return {
  result: [
    { id: 1, name: "Alice", score: 88, dept: "eng" },
    { id: 2, name: "Bob", score: 52, dept: "sales" },
    { id: 3, name: "Carol", score: 91, dept: "eng" },
    { id: 4, name: "Dave", score: 67, dept: "ops" },
    { id: 5, name: "Eve", score: 45, dept: "sales" },
  ],
};`,
      }),
      node("filter", "data-transform", "过滤及格用户", 280, 120, {
        operation: "filter",
        expression: "item.score >= 60",
      }, [{ id: "data", name: "输入数据", type: "array" }]),
      node("count", "data-transform", "统计人数", 560, 120, {
        operation: "count",
      }, [{ id: "data", name: "输入数据", type: "any" }]),
      node("report", "code-javascript", "生成报告", 840, 120, {
        code: `const count = inputs.data;
const users = inputs.users;
return {
  result: {
    passedCount: count,
    topUser: Array.isArray(users) && users.length
      ? users.reduce((a, b) => (a.score > b.score ? a : b))
      : null,
    generatedAt: new Date().toISOString(),
  },
};`,
      }, [
        { id: "data", name: "数量", type: "any" },
        { id: "users", name: "用户", type: "any" },
      ]),
    ],
    edges: [
      edge("e1", "gen", "result", "filter", "data"),
      edge("e2", "gen", "result", "report", "users"),
      edge("e3", "filter", "result", "count", "data"),
      edge("e4", "count", "result", "report", "data"),
    ],
    variables: [],
    triggers: [{ type: "manual", enabled: true, config: {} }],
    settings: DEFAULT_SETTINGS,
    createdAt: TS,
    updatedAt: TS,
  },

  // 2. Condition router
  {
    id: "tpl-02-condition-router",
    name: "条件分支路由",
    description: "【官方模板】分数判断 → 及格/不及格 双路径合并",
    version: "1.0.0",
    nodes: [
      node("score", "code-javascript", "生成分数", 0, 160, {
        code: `return { result: 73 };`,
      }),
      node("branch", "flow-condition", "是否及格(>=60)", 280, 160, {
        operator: ">=",
        compareValue: 60,
      }, [{ id: "value", name: "判断值", type: "any" }]),
      node("pass", "code-javascript", "及格处理", 560, 60, {
        code: `return { result: { status: "pass", data: inputs.value, msg: "恭喜及格" } };`,
      }, [{ id: "data", name: "数据", type: "any" }]),
      node("fail", "code-javascript", "不及格处理", 560, 260, {
        code: `return { result: { status: "fail", data: inputs.value, msg: "需要补考" } };`,
      }, [{ id: "data", name: "数据", type: "any" }]),
      node("merge", "code-javascript", "合并结果", 840, 160, {
        code: `return {
  result: {
    pass: inputs.pass,
    fail: inputs.fail,
    final: inputs.pass ?? inputs.fail,
  },
};`,
      }, [
        { id: "pass", name: "及格", type: "any" },
        { id: "fail", name: "不及格", type: "any" },
      ]),
    ],
    edges: [
      edge("e1", "score", "result", "branch", "value"),
      edge("e2", "branch", "true", "pass", "data"),
      edge("e3", "branch", "false", "fail", "data"),
      edge("e4", "pass", "result", "merge", "pass"),
      edge("e5", "fail", "result", "merge", "fail"),
    ],
    variables: [],
    triggers: [{ type: "manual", enabled: true, config: {} }],
    settings: DEFAULT_SETTINGS,
    createdAt: TS,
    updatedAt: TS,
  },

  // 3. Loop batch
  {
    id: "tpl-03-loop-batch",
    name: "循环批处理",
    description: "【官方模板】forEach 循环处理订单并汇总",
    version: "1.0.0",
    nodes: [
      node("orders", "code-javascript", "生成订单", 0, 120, {
        code: `return {
  result: [
    { sku: "A", qty: 2, price: 10 },
    { sku: "B", qty: 1, price: 25 },
    { sku: "C", qty: 5, price: 3 },
  ],
};`,
      }),
      node("loop", "flow-loop", "计算行金额", 280, 120, {
        mode: "forEach",
        expression: "{ sku: item.sku, total: item.qty * item.price }",
      }, [{ id: "items", name: "数组数据", type: "array" }]),
      node("stats", "data-transform", "统计条数", 560, 120, {
        operation: "count",
      }, [{ id: "data", name: "输入数据", type: "any" }]),
      node("sum", "code-javascript", "求总金额", 840, 120, {
        code: `const rows = inputs.rows;
const total = Array.isArray(rows)
  ? rows.reduce((s, r) => s + (r.total ?? 0), 0)
  : 0;
return { result: { rowCount: inputs.count, grandTotal: total, rows } };`,
      }, [
        { id: "rows", name: "行数据", type: "any" },
        { id: "count", name: "数量", type: "any" },
      ]),
    ],
    edges: [
      edge("e1", "orders", "result", "loop", "items"),
      edge("e2", "loop", "results", "stats", "data"),
      edge("e3", "loop", "results", "sum", "rows"),
      edge("e4", "stats", "result", "sum", "count"),
    ],
    variables: [],
    triggers: [{ type: "manual", enabled: true, config: {} }],
    settings: DEFAULT_SETTINGS,
    createdAt: TS,
    updatedAt: TS,
  },

  // 4. Parallel merge
  {
    id: "tpl-04-parallel-merge",
    name: "并行任务汇聚",
    description: "【官方模板】一分三并行延时后汇聚（测试并发调度）",
    version: "1.0.0",
    nodes: [
      node("start", "code-javascript", "发起任务", 0, 200, {
        code: `return { result: { taskId: "T-" + Date.now(), label: "并行演示" } };`,
      }),
      node("delay-a", "flow-delay", "分支 A 等待", 300, 80, { duration: 80 }),
      node("delay-b", "flow-delay", "分支 B 等待", 300, 200, { duration: 150 }),
      node("delay-c", "flow-delay", "分支 C 等待", 300, 320, { duration: 220 }),
      node("merge", "code-javascript", "汇聚结果", 620, 200, {
        code: `return {
  result: {
    task: inputs.task,
    branches: { a: inputs.a, b: inputs.b, c: inputs.c },
    finishedAt: Date.now(),
  },
};`,
      }, [
        { id: "task", name: "任务", type: "any" },
        { id: "a", name: "A", type: "any" },
        { id: "b", name: "B", type: "any" },
        { id: "c", name: "C", type: "any" },
      ]),
    ],
    edges: [
      edge("e1", "start", "result", "delay-a", "passthrough"),
      edge("e2", "start", "result", "delay-b", "passthrough"),
      edge("e3", "start", "result", "delay-c", "passthrough"),
      edge("e4", "start", "result", "merge", "task"),
      edge("e5", "delay-a", "passthrough", "merge", "a"),
      edge("e6", "delay-b", "passthrough", "merge", "b"),
      edge("e7", "delay-c", "passthrough", "merge", "c"),
    ],
    variables: [],
    triggers: [{ type: "manual", enabled: true, config: {} }],
    settings: { ...DEFAULT_SETTINGS, concurrencyLimit: 5 },
    createdAt: TS,
    updatedAt: TS,
  },

  // 5. HTTP fetch
  {
    id: "tpl-05-http-fetch",
    name: "HTTP API 聚合",
    description: "【官方模板】请求公开 API → 提取字段 → 格式化（需联网）",
    version: "1.0.0",
    nodes: [
      node("fetch", "io-http-request", "获取 Todo", 0, 120, {
        url: "https://jsonplaceholder.typicode.com/todos/1",
        method: "GET",
        responseType: "json",
        timeout: 15000,
      }),
      node("pick", "data-transform", "提取字段", 300, 120, {
        operation: "pick",
        fields: "title,completed,userId",
      }, [{ id: "data", name: "输入数据", type: "any" }]),
      node("format", "code-javascript", "格式化输出", 600, 120, {
        code: `const d = inputs.data;
return {
  result: {
    title: d?.title ?? "(unknown)",
    done: Boolean(d?.completed),
    userId: d?.userId,
    fetchedAt: new Date().toISOString(),
  },
};`,
      }, [{ id: "data", name: "数据", type: "any" }]),
    ],
    edges: [
      edge("e1", "fetch", "data", "pick", "data"),
      edge("e2", "pick", "result", "format", "data"),
    ],
    variables: [],
    triggers: [{ type: "manual", enabled: true, config: {} }],
    settings: DEFAULT_SETTINGS,
    createdAt: TS,
    updatedAt: TS,
  },

  // 6. File ETL
  {
    id: "tpl-06-file-etl",
    name: "文件读写 ETL",
    description: "【官方模板】生成内容 → 写入文件 → 读取 → 转换",
    version: "1.0.0",
    nodes: [
      node("prep", "code-javascript", "准备内容", 0, 120, {
        code: `return {
  result: JSON.stringify({
    pipeline: "file-etl",
    rows: [{ id: 1, v: "alpha" }, { id: 2, v: "beta" }],
    ts: Date.now(),
  }, null, 2),
};`,
      }),
      node("write", "io-file-write", "写入文件", 280, 120, {
        path: "seed-data/etl-output.json",
        createDirs: true,
      }, [{ id: "content", name: "内容", type: "string" }]),
      node("read", "io-file-read", "读取文件", 560, 120, {
        path: "seed-data/etl-output.json",
      }),
      node("parse", "code-javascript", "解析 JSON", 840, 120, {
        code: `const raw = inputs.content;
const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
return { result: { rowCount: parsed.rows?.length ?? 0, pipeline: parsed.pipeline } };`,
      }, [{ id: "content", name: "内容", type: "string" }]),
    ],
    edges: [
      edge("e1", "prep", "result", "write", "content"),
      edge("e2", "write", "success", "read", "input"),
      edge("e3", "read", "content", "parse", "content"),
    ],
    variables: [],
    triggers: [{ type: "manual", enabled: true, config: {} }],
    settings: DEFAULT_SETTINGS,
    createdAt: TS,
    updatedAt: TS,
  },

  // 7. Error continue
  {
    id: "tpl-07-error-continue",
    name: "容错继续执行",
    description: "【官方模板】continue 策略 + 并行支路（含模拟失败节点）",
    version: "1.0.0",
    nodes: [
      node("ok", "code-javascript", "正常节点", 0, 120, {
        code: `return { result: { step: "ok", value: 1 } };`,
      }),
      node("fail", "code-javascript", "模拟失败(不抛异常)", 280, 120, {
        code: `return { result: { ok: false, reason: "演示：此节点模拟失败但不中断引擎" } };`,
      }),
      node("after", "code-javascript", "失败后续", 560, 220, {
        code: `return { result: { step: "after-fail", note: "上游失败后被跳过" } };`,
      }),
      node("side", "code-javascript", "并行成功支路", 560, 20, {
        code: `return { result: { step: "side", value: inputs.prev?.value + 100 } };`,
      }, [{ id: "prev", name: "前值", type: "any" }]),
      node("final", "code-javascript", "汇总", 840, 120, {
        code: `return { result: { side: inputs.side, after: inputs.after } };`,
      }, [
        { id: "side", name: "侧路", type: "any" },
        { id: "after", name: "后续", type: "any" },
      ]),
    ],
    edges: [
      edge("e1", "ok", "result", "fail", "input"),
      edge("e2", "fail", "result", "after", "input"),
      edge("e3", "ok", "result", "side", "prev"),
      edge("e4", "side", "result", "final", "side"),
      edge("e5", "after", "result", "final", "after"),
    ],
    variables: [],
    triggers: [{ type: "manual", enabled: true, config: {} }],
    settings: { ...DEFAULT_SETTINGS, errorStrategy: "continue" },
    createdAt: TS,
    updatedAt: TS,
  },

  // 8. JS chain with expressions
  {
    id: "tpl-08-js-chain",
    name: "多级 JS 编排",
    description: "【官方模板】5 段 JS + 表达式传参链式处理",
    version: "1.0.0",
    nodes: [
      node("s1", "code-javascript", "阶段1-初始化", 0, 120, {
        code: `return { result: { items: [1, 2, 3, 4, 5], multiplier: 2 } };`,
      }),
      node("s2", "code-javascript", "阶段2-缩放", 220, 120, {
        code: `const base = inputs.payload;
const items = base.items.map((n) => n * base.multiplier);
return { result: { ...base, items, stage: 2 } };`,
      }, [{ id: "payload", name: "载荷", type: "any" }]),
      node("s3", "code-javascript", "阶段3-过滤", 440, 120, {
        code: `const p = inputs.payload;
return { result: { ...p, items: p.items.filter((n) => n > 4), stage: 3 } };`,
      }, [{ id: "payload", name: "载荷", type: "any" }]),
      node("s4", "data-transform", "阶段4-计数", 660, 120, {
        operation: "count",
      }, [{ id: "data", name: "输入", type: "any" }]),
      node("s5", "code-javascript", "阶段5-收尾", 880, 120, {
        code: `return {
  result: {
    count: inputs.count,
    lastPayload: inputs.payload,
    done: true,
  },
};`,
      }, [
        { id: "count", name: "计数", type: "any" },
        { id: "payload", name: "载荷", type: "any" },
      ]),
    ],
    edges: [
      edge("e1", "s1", "result", "s2", "payload"),
      edge("e2", "s2", "result", "s3", "payload"),
      edge("e3", "s3", "result", "s4", "data"),
      edge("e4", "s3", "result", "s5", "payload"),
      edge("e5", "s4", "result", "s5", "count"),
    ],
    variables: [],
    triggers: [{ type: "manual", enabled: true, config: {} }],
    settings: DEFAULT_SETTINGS,
    createdAt: TS,
    updatedAt: TS,
  },

  // 9. Cache layer
  {
    id: "tpl-09-cache-layer",
    name: "缓存加速层",
    description: "【官方模板】相同数据两次经过缓存节点（第二次命中）",
    version: "1.0.0",
    nodes: [
      node("data", "code-javascript", "生成数据", 0, 160, {
        code: `return { result: { id: "cache-demo", values: [1, 2, 3] } };`,
      }),
      node("cache1", "tool-cache", "缓存层 1", 280, 80, { ttl: 3600000, maxEntries: 500 }),
      node("cache2", "tool-cache", "缓存层 2", 280, 240, { ttl: 3600000, maxEntries: 500 }),
      node("proc1", "code-javascript", "处理路径1", 560, 80, {
        code: `return { result: { path: 1, hit: inputs.hit, size: inputs.size, data: inputs.data } };`,
      }, [
        { id: "data", name: "数据", type: "any" },
        { id: "hit", name: "命中", type: "boolean" },
        { id: "size", name: "大小", type: "number" },
      ]),
      node("proc2", "code-javascript", "处理路径2", 560, 240, {
        code: `return { result: { path: 2, hit: inputs.hit, data: inputs.data } };`,
      }, [
        { id: "data", name: "数据", type: "any" },
        { id: "hit", name: "命中", type: "boolean" },
      ]),
      node("summary", "code-javascript", "对比缓存", 840, 160, {
        code: `return { result: { first: inputs.p1, second: inputs.p2 } };`,
      }, [
        { id: "p1", name: "路径1", type: "any" },
        { id: "p2", name: "路径2", type: "any" },
      ]),
    ],
    edges: [
      edge("e1", "data", "result", "cache1", "data"),
      edge("e2", "data", "result", "cache2", "data"),
      edge("e3", "cache1", "result", "proc1", "data"),
      edge("e4", "cache1", "cacheHit", "proc1", "hit"),
      edge("e5", "cache1", "cacheSize", "proc1", "size"),
      edge("e6", "cache2", "result", "proc2", "data"),
      edge("e7", "cache2", "cacheHit", "proc2", "hit"),
      edge("e8", "proc1", "result", "summary", "p1"),
      edge("e9", "proc2", "result", "summary", "p2"),
    ],
    variables: [],
    triggers: [{ type: "manual", enabled: true, config: {} }],
    settings: DEFAULT_SETTINGS,
    createdAt: TS,
    updatedAt: TS,
  },

  // 10. Full automation
  {
    id: "tpl-10-full-automation",
    name: "综合自动化流程",
    description: "【官方模板】输入参数 → 条件 → 循环 → 延时 → 转换 → 报告",
    version: "1.0.0",
    nodes: [
      node("input", "code-javascript", "读取工作流输入", 0, 200, {
        code: `const threshold = inputs.threshold ?? 50;
const items = inputs.items ?? [10, 20, 30, 40, 55, 70];
return { result: { threshold, items } };`,
      }, [
        { id: "threshold", name: "阈值", type: "number" },
        { id: "items", name: "数据项", type: "any" },
      ]),
      node("pick-thresh", "code-javascript", "提取阈值", 200, 200, {
        code: `return { result: inputs.payload.threshold };`,
      }, [{ id: "payload", name: "载荷", type: "any" }]),
      node("pick-items", "code-javascript", "提取数据项", 200, 80, {
        code: `return { result: inputs.payload.items };`,
      }, [{ id: "payload", name: "载荷", type: "any" }]),
      node("check", "flow-condition", "阈值检查(>=40)", 400, 200, {
        operator: ">=",
        compareValue: 40,
      }, [{ id: "value", name: "判断值", type: "any" }]),
      node("loop", "flow-loop", "循环加工", 640, 120, {
        mode: "forEach",
        expression: "item * 2",
      }, [{ id: "items", name: "数组", type: "array" }]),
      node("wait", "flow-delay", "缓冲等待", 880, 120, { duration: 50 }),
      node("count", "data-transform", "统计结果", 1120, 120, { operation: "count" }, [
        { id: "data", name: "数据", type: "any" },
      ]),
      node("bypass", "code-javascript", "低阈值旁路", 640, 320, {
        code: `return { result: { bypass: true, note: "阈值条件为假" } };`,
      }),
      node("report", "code-javascript", "最终报告", 1360, 200, {
        code: `return {
  result: {
    mode: inputs.bypass ? "bypass" : "pipeline",
    count: inputs.count,
    bypass: inputs.bypass,
    completedAt: new Date().toISOString(),
  },
};`,
      }, [
        { id: "count", name: "计数", type: "any" },
        { id: "bypass", name: "旁路", type: "any" },
      ]),
    ],
    edges: [
      edge("e1", "input", "result", "pick-thresh", "payload"),
      edge("e2", "input", "result", "pick-items", "payload"),
      edge("e3", "pick-thresh", "result", "check", "value"),
      edge("e4", "pick-items", "result", "loop", "items"),
      edge("e5", "loop", "results", "wait", "passthrough"),
      edge("e6", "wait", "passthrough", "count", "data"),
      edge("e7", "check", "false", "bypass", "input"),
      edge("e8", "count", "result", "report", "count"),
      edge("e9", "bypass", "result", "report", "bypass"),
    ],
    variables: [],
    triggers: [{ type: "manual", enabled: true, config: {} }],
    settings: DEFAULT_SETTINGS,
    createdAt: TS,
    updatedAt: TS,
  },
];

export async function seedDefaultWorkflows(storage: FileWorkflowStorage): Promise<number> {
  const existing = await storage.list();
  const existingIds = new Set(existing.map((w) => w.id));
  let seeded = 0;

  for (const template of DEFAULT_WORKFLOW_TEMPLATES) {
    if (existingIds.has(template.id)) continue;
    await storage.create(template);
    seeded++;
  }

  return seeded;
}

/** Export templates to JSON files (for CLI testing). */
export async function writeTemplateFiles(dir: string = TEMPLATES_DIR): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
  for (const wf of DEFAULT_WORKFLOW_TEMPLATES) {
    const safe = wf.id.replace(/[^a-zA-Z0-9_-]/g, "_");
    await writeFile(join(dir, `${safe}.json`), JSON.stringify(wf, null, 2), "utf-8");
  }
}

/** Load templates from disk if present. */
export async function loadTemplatesFromDir(dir: string): Promise<Workflow[]> {
  try {
    const files = await readdir(dir);
    const workflows: Workflow[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const content = await readFile(join(dir, file), "utf-8");
      workflows.push(JSON.parse(content) as Workflow);
    }
    return workflows;
  } catch {
    return DEFAULT_WORKFLOW_TEMPLATES;
  }
}
