/**
 * Flow module tests — condition and loop
 */

import { describe, it, expect } from "vitest";
import { conditionModule } from "../src/modules/flow/condition.js";
import { loopModule } from "../src/modules/flow/loop.js";
import type { ExecutionContext } from "../src/types.js";

const mockContext = {} as ExecutionContext;

describe("conditionModule", () => {
  it("should evaluate truthy values", async () => {
    const result = await conditionModule.execute({ value: "hello" }, { operator: "truthy" }, mockContext);
    expect(result.true).toBe("hello");
    expect(result.false).toBeUndefined();
  });

  it("should evaluate falsy values", async () => {
    const result = await conditionModule.execute({ value: "" }, { operator: "truthy" }, mockContext);
    expect(result.true).toBeUndefined();
    expect(result.false).toBe("");
  });

  it("should compare with ==", async () => {
    const result = await conditionModule.execute({ value: 42 }, { operator: "==", compareValue: 42 }, mockContext);
    expect(result.result).toBe(true);
  });

  it("should compare with !=", async () => {
    const result = await conditionModule.execute({ value: "a" }, { operator: "!=", compareValue: "b" }, mockContext);
    expect(result.result).toBe(true);
  });

  it("should compare numbers with >", async () => {
    const result = await conditionModule.execute({ value: 10 }, { operator: ">", compareValue: 5 }, mockContext);
    expect(result.result).toBe(true);
  });

  it("should check contains", async () => {
    const result = await conditionModule.execute({ value: "hello world" }, { operator: "contains", compareValue: "world" }, mockContext);
    expect(result.result).toBe(true);
  });

  it("should check empty", async () => {
    expect((await conditionModule.execute({ value: "" }, { operator: "empty" }, mockContext)).result).toBe(true);
    expect((await conditionModule.execute({ value: null }, { operator: "empty" }, mockContext)).result).toBe(true);
    expect((await conditionModule.execute({ value: [] }, { operator: "empty" }, mockContext)).result).toBe(true);
    expect((await conditionModule.execute({ value: "x" }, { operator: "empty" }, mockContext)).result).toBe(false);
  });

  it("should check notEmpty", async () => {
    expect((await conditionModule.execute({ value: "x" }, { operator: "notEmpty" }, mockContext)).result).toBe(true);
    expect((await conditionModule.execute({ value: "" }, { operator: "notEmpty" }, mockContext)).result).toBe(false);
  });

  it("should check startsWith and endsWith", async () => {
    expect((await conditionModule.execute({ value: "hello" }, { operator: "startsWith", compareValue: "hel" }, mockContext)).result).toBe(true);
    expect((await conditionModule.execute({ value: "hello" }, { operator: "endsWith", compareValue: "llo" }, mockContext)).result).toBe(true);
  });
});

describe("loopModule", () => {
  it("should iterate over array with forEach", async () => {
    const result = await loopModule.execute(
      { items: [1, 2, 3, 4, 5] },
      { mode: "forEach", expression: "item * 2" },
      mockContext
    );
    expect(result.results).toEqual([2, 4, 6, 8, 10]);
    expect(result.count).toBe(5);
  });

  it("should handle identity expression", async () => {
    const result = await loopModule.execute(
      { items: ["a", "b", "c"] },
      { mode: "forEach", expression: "item" },
      mockContext
    );
    expect(result.results).toEqual(["a", "b", "c"]);
  });

  it("should respect maxIterations", async () => {
    const result = await loopModule.execute(
      { items: Array.from({ length: 100 }, (_, i) => i) },
      { mode: "forEach", expression: "item", maxIterations: 10 },
      mockContext
    );
    expect(result.count).toBe(10);
  });

  it("should execute while loop", async () => {
    const result = await loopModule.execute(
      {},
      { mode: "while", condition: "counter < 5", expression: "counter * counter", maxIterations: 100 },
      mockContext
    );
    expect(result.results).toEqual([0, 1, 4, 9, 16]);
    expect(result.count).toBe(5);
  });

  it("should stop while loop when condition is false", async () => {
    const result = await loopModule.execute(
      {},
      { mode: "while", condition: "false", expression: "counter" },
      mockContext
    );
    expect(result.count).toBe(0);
  });

  it("should throw on non-array input for forEach", async () => {
    await expect(
      loopModule.execute({ items: "not an array" }, { mode: "forEach" }, mockContext)
    ).rejects.toThrow();
  });
});
