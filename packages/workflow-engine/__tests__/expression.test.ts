import { describe, it, expect } from "vitest";
import { resolveExpressions, resolveExpressionsDeep, type ExpressionContext } from "../src/expression.js";

function makeContext(overrides: Partial<ExpressionContext> = {}): ExpressionContext {
  return {
    nodeOutputs: new Map(),
    inputs: {},
    variables: {},
    env: {},
    ...overrides,
  };
}

describe("resolveExpressions", () => {
  it("should return non-string values unchanged", () => {
    const ctx = makeContext();
    expect(resolveExpressions(42, ctx)).toBe(42);
    expect(resolveExpressions(null, ctx)).toBe(null);
    expect(resolveExpressions(true, ctx)).toBe(true);
  });

  it("should resolve input references", () => {
    const ctx = makeContext({ inputs: { filePath: "/tmp/test.txt" } });
    expect(resolveExpressions("{{input.filePath}}", ctx)).toBe("/tmp/test.txt");
  });

  it("should resolve node output references", () => {
    const outputs = new Map<string, unknown>();
    outputs.set("node-1", { content: "hello world", size: 11 });
    const ctx = makeContext({ nodeOutputs: outputs });

    expect(resolveExpressions("{{node-1.content}}", ctx)).toBe("hello world");
    expect(resolveExpressions("{{node-1.size}}", ctx)).toBe(11);
  });

  it("should resolve variable references", () => {
    const ctx = makeContext({ variables: { apiKey: "sk-123" } });
    expect(resolveExpressions("{{vars.apiKey}}", ctx)).toBe("sk-123");
  });

  it("should resolve env references", () => {
    const ctx = makeContext({ env: { NODE_ENV: "test" } });
    expect(resolveExpressions("{{env.NODE_ENV}}", ctx)).toBe("test");
  });

  it("should handle mixed template strings", () => {
    const ctx = makeContext({ inputs: { name: "World" } });
    expect(resolveExpressions("Hello, {{input.name}}!", ctx)).toBe("Hello, World!");
  });

  it("should handle multiple expressions in one string", () => {
    const ctx = makeContext({ inputs: { first: "John", last: "Doe" } });
    expect(resolveExpressions("{{input.first}} {{input.last}}", ctx)).toBe("John Doe");
  });

  it("should return undefined for missing references (single expression)", () => {
    const ctx = makeContext();
    expect(resolveExpressions("{{input.missing}}", ctx)).toBeUndefined();
  });

  it("should return empty string for missing references in mixed templates", () => {
    const ctx = makeContext();
    expect(resolveExpressions("prefix-{{input.missing}}-suffix", ctx)).toBe("prefix--suffix");
  });

  it("should support ?? default value operator", () => {
    const ctx = makeContext();
    expect(resolveExpressions('{{input.missing ?? "default"}}', ctx)).toBe("default");
    expect(resolveExpressions("{{input.missing ?? 42}}", ctx)).toBe(42);
    expect(resolveExpressions("{{input.missing ?? true}}", ctx)).toBe(true);
  });

  it("should handle ?? in default value string without breaking", () => {
    const ctx = makeContext();
    // Default value itself contains ?? — should not be split further
    expect(resolveExpressions('{{input.missing ?? "what??"}}', ctx)).toBe("what??");
  });

  it("should not use default when value exists", () => {
    const ctx = makeContext({ inputs: { name: "Alice" } });
    expect(resolveExpressions('{{input.name ?? "default"}}', ctx)).toBe("Alice");
  });

  it("should preserve object type for single expression", () => {
    const outputs = new Map<string, unknown>();
    outputs.set("node-1", { data: { nested: [1, 2, 3] } });
    const ctx = makeContext({ nodeOutputs: outputs });

    const result = resolveExpressions("{{node-1.data}}", ctx);
    expect(result).toEqual({ nested: [1, 2, 3] });
  });
});

describe("resolveExpressionsDeep", () => {
  it("should resolve expressions in nested objects", () => {
    const ctx = makeContext({ inputs: { model: "gpt-4o", temp: "0.3" } });

    const config = {
      model: "{{input.model}}",
      temperature: "{{input.temp}}",
      messages: [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "Hello" },
      ],
    };

    const result = resolveExpressionsDeep(config, ctx);
    expect(result).toEqual({
      model: "gpt-4o",
      temperature: "0.3",
      messages: [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "Hello" },
      ],
    });
  });

  it("should resolve expressions in arrays", () => {
    const ctx = makeContext({ inputs: { lang: "zh" } });
    const arr = ["translate to {{input.lang}}", "keep {{input.lang}}"];
    const result = resolveExpressionsDeep(arr, ctx);
    expect(result).toEqual(["translate to zh", "keep zh"]);
  });
});
