/**
 * tool-scheduler module — Time-based utilities for workflow scheduling.
 *
 * Backed by the `cron-parser` library, supporting full cron syntax
 * including ranges (1-5), steps (* / 5), lists (1,3,5), weekdays (MON-FRI),
 * months (JAN-DEC), and timezone-aware calculations.
 *
 * Provides: cron expression parsing, next run time calculation,
 * "wait until" capability, and time formatting.
 *
 * Note: This is NOT a background scheduler daemon. It's a node that:
 * 1. Calculates when the next scheduled time is
 * 2. Optionally waits until that time
 * 3. Outputs timing information for downstream nodes
 */

import { CronExpressionParser } from "cron-parser";
import type { ModuleHandler, ExecutionContext } from "../../types.js";

// Maximum allowed wait durations (defensive caps)
const MAX_WAIT_DURATION_MS = 60 * 60 * 1000;          // 1 hour
const MAX_WAIT_UNTIL_MS = 24 * 60 * 60 * 1000;        // 24 hours

export const toolSchedulerModule: ModuleHandler = {
  meta: {
    id: "tool-scheduler",
    name: "定时调度",
    category: "tool",
    description:
      "时间调度工具：计算下次 cron 执行时间、等待到指定时间、时间格式化（基于 cron-parser，支持完整 cron 语法和时区）",
    icon: "clock",
    inputs: [
      { id: "timestamp", name: "时间戳", type: "number" },
    ],
    outputs: [
      { id: "now", name: "当前时间(ISO)", type: "string" },
      { id: "timestamp", name: "时间戳(ms)", type: "number" },
      { id: "formatted", name: "格式化时间", type: "string" },
      { id: "waited", name: "等待时间(ms)", type: "number" },
      { id: "nextRuns", name: "未来 N 次执行时间", type: "array" },
    ],
    configSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["now", "format", "wait_until", "wait_duration", "next_cron"],
          default: "now",
          description:
            "操作：now=当前时间, format=格式化, wait_until=等到指定时间, wait_duration=等待N毫秒, next_cron=下次 cron 执行",
        },
        format: {
          type: "string",
          default: "YYYY-MM-DD HH:mm:ss",
          description: "时间格式（now/format 操作）",
        },
        waitUntil: {
          type: "string",
          description: "等待到的时间（ISO 8601，如 2025-12-31T23:59:59Z）",
        },
        duration: {
          type: "number",
          default: 1000,
          minimum: 0,
          maximum: MAX_WAIT_DURATION_MS,
          description: `等待时长（毫秒，wait_duration 操作）。最大 ${MAX_WAIT_DURATION_MS}ms`,
        },
        cron: {
          type: "string",
          examples: [
            "0 9 * * 1-5",           // 工作日 9 点
            "*/5 * * * *",           // 每 5 分钟
            "0 0 1 * *",             // 每月 1 号 0 点
            "0 0 * * MON,WED,FRI",   // 周一三五
            "0 */2 * * *",           // 每 2 小时
            "30 14 * JAN-MAR *",     // 1-3 月每天 14:30
          ],
          description:
            "Cron 表达式（5 字段：分 时 日 月 周；支持 *、范围 1-5、步进 */5、列表 1,3,5、月份/周缩写）",
        },
        timezone: {
          type: "string",
          default: "Asia/Shanghai",
          examples: [
            "UTC",
            "Asia/Shanghai",
            "America/New_York",
            "Europe/London",
          ],
          description: "IANA 时区名（影响 cron 计算和格式化输出）",
        },
        nextCount: {
          type: "number",
          default: 1,
          minimum: 1,
          maximum: 100,
          description: "next_cron 操作返回未来多少次执行时间",
        },
      },
      required: ["operation"],
    },
  },

  async execute(
    inputs: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<Record<string, unknown>> {
    const operation = config.operation as string;
    const format = (config.format as string) ?? "YYYY-MM-DD HH:mm:ss";
    const timezone = (config.timezone as string) ?? "Asia/Shanghai";
    const now = new Date();

    switch (operation) {
      case "now":
        return buildResult(now, format, timezone, 0);

      case "format": {
        const ts = (inputs.timestamp as number) ?? now.getTime();
        return buildResult(new Date(ts), format, timezone, 0);
      }

      case "wait_until": {
        const target = parseDate(config.waitUntil as string);
        const waitMs = Math.max(0, target.getTime() - now.getTime());
        if (waitMs > MAX_WAIT_UNTIL_MS) {
          throw new Error(
            `wait_until target is more than ${MAX_WAIT_UNTIL_MS / 3600000}h in the future. ` +
            `Use a workflow trigger for long delays.`
          );
        }
        if (waitMs > 0) {
          await sleepCancellable(waitMs, context);
        }
        return buildResult(new Date(), format, timezone, waitMs);
      }

      case "wait_duration": {
        const requested = (config.duration as number) ?? 1000;
        const cappedDuration = Math.min(Math.max(0, requested), MAX_WAIT_DURATION_MS);
        if (cappedDuration > 0) {
          await sleepCancellable(cappedDuration, context);
        }
        return buildResult(new Date(), format, timezone, cappedDuration);
      }

      case "next_cron": {
        const cron = config.cron as string;
        if (!cron) throw new Error("next_cron operation requires the cron field");
        const count = Math.max(1, Math.min(100, (config.nextCount as number) ?? 1));

        let parser;
        try {
          parser = CronExpressionParser.parse(cron, {
            tz: timezone,
            currentDate: now,
          });
        } catch (err) {
          throw new Error(
            `Invalid cron expression "${cron}": ${err instanceof Error ? err.message : String(err)}`
          );
        }

        const nextRuns: Array<{ iso: string; timestamp: number; formatted: string }> = [];
        for (let i = 0; i < count; i++) {
          try {
            const next = parser.next().toDate();
            nextRuns.push({
              iso: next.toISOString(),
              timestamp: next.getTime(),
              formatted: formatDate(next, format, timezone),
            });
          } catch {
            break;
          }
        }

        const firstNext = nextRuns[0];
        if (!firstNext) {
          throw new Error(`Cron expression "${cron}" produced no future runs`);
        }

        return {
          now: now.toISOString(),
          timestamp: firstNext.timestamp,
          formatted: firstNext.formatted,
          waited: firstNext.timestamp - now.getTime(),
          nextRuns,
        };
      }

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildResult(
  date: Date,
  format: string,
  timezone: string,
  waited: number
): Record<string, unknown> {
  return {
    now: date.toISOString(),
    timestamp: date.getTime(),
    formatted: formatDate(date, format, timezone),
    waited,
    nextRuns: [],
  };
}

function parseDate(input: string): Date {
  if (!input) {
    throw new Error("waitUntil is required for wait_until operation");
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: "${input}". Use ISO 8601 format (e.g. 2025-12-31T23:59:59Z)`);
  }
  return date;
}

/**
 * Format a Date in the given timezone using the supplied template.
 * Supports tokens: YYYY MM DD HH mm ss
 */
function formatDate(date: Date, template: string, timezone: string): string {
  // Use Intl.DateTimeFormat to get parts in the target timezone
  let parts: Intl.DateTimeFormatPart[];
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    parts = formatter.formatToParts(date);
  } catch {
    // Fallback to UTC if invalid timezone
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    parts = formatter.formatToParts(date);
  }

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";

  // Intl returns hour 24 as "24" or "00" depending on locale; en-US with hour12=false uses "00"-"23"
  const hour = get("hour");
  const normalizedHour = hour === "24" ? "00" : hour;

  return template
    .replace("YYYY", get("year"))
    .replace("MM", get("month"))
    .replace("DD", get("day"))
    .replace("HH", normalizedHour)
    .replace("mm", get("minute"))
    .replace("ss", get("second"));
}

/**
 * Sleep that can be cancelled by ExecutionContext.signal (when wired up).
 * Today, ExecutionContext doesn't carry signal — but we expose the hook
 * so the engine can pass it later without changing this module.
 */
async function sleepCancellable(ms: number, _context: ExecutionContext): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
