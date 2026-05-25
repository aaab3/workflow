/**
 * Cache module tests — covers LRU eviction, TTL expiry, hash stability.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  toolCacheModule,
  __resetCacheForTests,
  __getCacheSizeForTests,
} from "../src/modules/tool/cache.js";
import type { ExecutionContext } from "../src/types.js";

function makeContext(): ExecutionContext {
  return {
    workflowId: "test",
    executionId: "exec",
    status: "running",
    startTime: Date.now(),
    nodeStates: new Map(),
    variables: {},
    logs: [],
    errors: [],
    metrics: { totalNodes: 0, completedNodes: 0, failedNodes: 0, skippedNodes: 0 },
  };
}

beforeEach(() => {
  __resetCacheForTests();
});

describe("toolCacheModule — basic operations", () => {
  it("caches input on first call (miss) and returns it on second (hit)", async () => {
    const data = { user: "alice", id: 42 };

    const first = await toolCacheModule.execute({ data }, {}, makeContext());
    expect(first.cacheHit).toBe(false);

    const second = await toolCacheModule.execute({ data }, {}, makeContext());
    expect(second.cacheHit).toBe(true);
    expect(second.result).toEqual(data);
    expect(second.hash).toBe(first.hash);
  });

  it("produces stable hash regardless of object key order", async () => {
    const a = await toolCacheModule.execute(
      { data: { x: 1, y: 2, z: 3 } },
      {},
      makeContext()
    );
    const b = await toolCacheModule.execute(
      { data: { z: 3, x: 1, y: 2 } },
      {},
      makeContext()
    );
    expect(b.hash).toBe(a.hash);
    expect(b.cacheHit).toBe(true);
  });

  it("different inputs produce different hashes", async () => {
    const a = await toolCacheModule.execute(
      { data: { x: 1 } },
      {},
      makeContext()
    );
    const b = await toolCacheModule.execute(
      { data: { x: 2 } },
      {},
      makeContext()
    );
    expect(a.hash).not.toBe(b.hash);
    expect(b.cacheHit).toBe(false);
  });

  it("respects enabled=false (always miss)", async () => {
    const data = { x: 1 };

    const first = await toolCacheModule.execute({ data }, { enabled: false }, makeContext());
    expect(first.cacheHit).toBe(false);

    const second = await toolCacheModule.execute({ data }, { enabled: false }, makeContext());
    expect(second.cacheHit).toBe(false);
  });
});

describe("toolCacheModule — TTL", () => {
  it("expires entries after TTL", async () => {
    const data = { x: 1 };

    await toolCacheModule.execute({ data }, { ttl: 50 }, makeContext());

    // Wait for expiry
    await new Promise((r) => setTimeout(r, 80));

    const second = await toolCacheModule.execute({ data }, { ttl: 50 }, makeContext());
    expect(second.cacheHit).toBe(false);
  });

  it("ttl=0 means no expiry", async () => {
    const data = { x: 1 };

    await toolCacheModule.execute({ data }, { ttl: 0 }, makeContext());

    // Wait
    await new Promise((r) => setTimeout(r, 50));

    const second = await toolCacheModule.execute({ data }, { ttl: 0 }, makeContext());
    expect(second.cacheHit).toBe(true);
  });
});

describe("toolCacheModule — LRU eviction", () => {
  it("evicts least-recently-used entry when maxEntries exceeded", async () => {
    // maxEntries=3
    await toolCacheModule.execute({ data: "a" }, { maxEntries: 3 }, makeContext());
    await toolCacheModule.execute({ data: "b" }, { maxEntries: 3 }, makeContext());
    await toolCacheModule.execute({ data: "c" }, { maxEntries: 3 }, makeContext());

    // All 3 are cached
    expect(__getCacheSizeForTests()).toBe(3);

    // Insert 4th — should evict 'a' (oldest)
    await toolCacheModule.execute({ data: "d" }, { maxEntries: 3 }, makeContext());
    expect(__getCacheSizeForTests()).toBe(3);

    // 'a' should be a miss now
    const aResult = await toolCacheModule.execute(
      { data: "a" },
      { maxEntries: 3 },
      makeContext()
    );
    expect(aResult.cacheHit).toBe(false);
  });

  it("access bumps entry to MRU (LRU is most-recently-unused)", async () => {
    await toolCacheModule.execute({ data: "a" }, { maxEntries: 3 }, makeContext());
    await toolCacheModule.execute({ data: "b" }, { maxEntries: 3 }, makeContext());
    await toolCacheModule.execute({ data: "c" }, { maxEntries: 3 }, makeContext());

    // Access 'a' to bump it to MRU
    const aHit = await toolCacheModule.execute(
      { data: "a" },
      { maxEntries: 3 },
      makeContext()
    );
    expect(aHit.cacheHit).toBe(true);

    // Now insert 'd' — should evict 'b' (least recently used), not 'a'
    await toolCacheModule.execute({ data: "d" }, { maxEntries: 3 }, makeContext());

    // 'a' should still be cached
    const aStill = await toolCacheModule.execute(
      { data: "a" },
      { maxEntries: 3 },
      makeContext()
    );
    expect(aStill.cacheHit).toBe(true);

    // 'b' should be evicted
    const bGone = await toolCacheModule.execute(
      { data: "b" },
      { maxEntries: 3 },
      makeContext()
    );
    expect(bGone.cacheHit).toBe(false);
  });

  it("shrinking maxEntries evicts down to new size", async () => {
    // Fill with 5 entries first (capacity=10)
    for (let i = 0; i < 5; i++) {
      await toolCacheModule.execute({ data: `item-${i}` }, { maxEntries: 10 }, makeContext());
    }
    expect(__getCacheSizeForTests()).toBe(5);

    // Shrink to 2 — should evict 3 oldest
    await toolCacheModule.execute({ data: `new` }, { maxEntries: 2 }, makeContext());
    expect(__getCacheSizeForTests()).toBeLessThanOrEqual(2);
  });

  it("does not exceed maxEntries even under heavy churn", async () => {
    for (let i = 0; i < 100; i++) {
      await toolCacheModule.execute({ data: `item-${i}` }, { maxEntries: 5 }, makeContext());
    }
    expect(__getCacheSizeForTests()).toBeLessThanOrEqual(5);
  });
});
