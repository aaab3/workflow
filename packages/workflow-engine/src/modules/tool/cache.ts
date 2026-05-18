/**
 * tool-cache module — In-memory content-hash cache with LRU + TTL eviction.
 *
 * Generates a SHA-256 hash of the input, checks an in-memory cache,
 * and returns cached results on hit or passes through on miss.
 *
 * Eviction:
 * - TTL: entries older than ttl ms are removed on access
 * - LRU: when maxEntries is exceeded, the least-recently-used entry is evicted
 *
 * Implementation note: Uses Map insertion order to track LRU position.
 * On every access (hit or set), the entry is re-inserted to move it to the
 * end of the iteration order (most recently used).
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import type { ModuleHandler, ExecutionContext } from "../../types.js";

// ─── LRU Cache implementation ──────────────────────────────────────────────
// Simple LRU using Map's insertion-order property:
// - Map iteration is in insertion order
// - Re-inserting an existing key moves it to the end
// - First key in Map is the least-recently-used

class LruTtlCache<V> {
  private store = new Map<string, { value: V; expiresAt: number }>();

  constructor(private maxEntries: number) {}

  /** Get + bump to MRU. Returns undefined if missing or expired. */
  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Move to MRU end
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  /** Set + evict LRU if over capacity. */
  set(key: string, value: V, ttlMs: number): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      // Evict the LRU entry (first in iteration order)
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /** Remove all expired entries. Useful for periodic maintenance. */
  cleanExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
      }
    }
  }

  size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  /** Update capacity. If new max is lower, evict LRU entries to fit. */
  setMaxEntries(max: number): void {
    this.maxEntries = max;
    while (this.store.size > max) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }
}

const DEFAULT_MAX_ENTRIES = 1000;
const cache = new LruTtlCache<unknown>(DEFAULT_MAX_ENTRIES);

const configZod = z.object({
  ttl: z.number().int().min(0).max(7 * 24 * 3600000).default(3600000)
    .describe("缓存有效期（毫秒），默认 1 小时。0 表示永不过期"),
  maxEntries: z.number().int().min(1).max(100000).default(DEFAULT_MAX_ENTRIES)
    .describe("最大缓存条目数（LRU 上限）。所有节点共享一份缓存"),
  enabled: z.boolean().default(true).describe("是否启用缓存"),
});

type Config = z.infer<typeof configZod>;

function computeHash(data: unknown): string {
  // Stable stringification — ensure key order doesn't affect the hash
  const json = stableStringify(data);
  return createHash("sha256").update(json).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

export const toolCacheModule: ModuleHandler = {
  meta: {
    id: "tool-cache",
    name: "数据缓存",
    category: "tool",
    description:
      "基于内容哈希的内存缓存（LRU + TTL），避免重复计算。命中时返回缓存值，未命中时透传输入。",
    icon: "database",
    inputs: [{ id: "data", name: "输入数据", type: "any" }],
    outputs: [
      { id: "result", name: "输出数据", type: "any" },
      { id: "cacheHit", name: "是否命中缓存", type: "boolean" },
      { id: "hash", name: "内容哈希(SHA-256)", type: "string" },
      { id: "cacheSize", name: "当前缓存条目数", type: "number" },
    ],
    configSchema: {}, // Auto-derived
    version: "2.0.0",
  },

  configZod,

  async execute(
    inputs: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext
  ): Promise<Record<string, unknown>> {
    const cfg = configZod.parse(config);
    const data = inputs.data;

    // Apply max entries change (cheap, idempotent)
    cache.setMaxEntries(cfg.maxEntries);

    const hash = computeHash(data);

    if (!cfg.enabled) {
      return { result: data, cacheHit: false, hash, cacheSize: cache.size() };
    }

    // Periodic cleanup — relatively cheap because Map iteration is O(n)
    // but n is bounded by maxEntries. Skip if cache is small.
    if (cache.size() > 100) {
      cache.cleanExpired();
    }

    // Check cache
    const cached = cache.get(hash);
    if (cached !== undefined) {
      return { result: cached, cacheHit: true, hash, cacheSize: cache.size() };
    }

    // Cache miss — store the input
    // ttl=0 means "no expiry" → use a very large TTL (10 years)
    const effectiveTtl = cfg.ttl === 0 ? 10 * 365 * 24 * 3600000 : cfg.ttl;
    cache.set(hash, data, effectiveTtl);

    return { result: data, cacheHit: false, hash, cacheSize: cache.size() };
  },

  async dispose(): Promise<void> {
    cache.clear();
  },
};

// ─── Test exports — only used by unit tests ─────────────────────────────────

/** @internal */
export function __resetCacheForTests(): void {
  cache.clear();
}

/** @internal */
export function __getCacheSizeForTests(): number {
  return cache.size();
}
