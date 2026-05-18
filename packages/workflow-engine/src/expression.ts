/**
 * Expression parser and evaluator for {{template}} syntax.
 *
 * Supported scopes:
 * - {{nodeId.portId}}   - reference upstream node output
 * - {{input.fieldName}} - workflow input parameters
 * - {{vars.varName}}    - global variables
 * - {{env.VAR_NAME}}    - environment variables (read-only)
 *
 * Supports ?? for default values: {{node-1.content ?? "fallback"}}
 */

export interface ExpressionContext {
  nodeOutputs: Map<string, unknown>;
  inputs: Record<string, unknown>;
  variables: Record<string, unknown>;
  env: Record<string, string | undefined>;
}

const EXPRESSION_REGEX = /\{\{(.+?)\}\}/g;

/**
 * Resolve all {{expressions}} in a string value.
 * If the entire string is a single expression, returns the raw value (preserving type).
 * If mixed with text, returns a string with interpolated values.
 */
export function resolveExpressions(
  template: unknown,
  context: ExpressionContext
): unknown {
  if (typeof template !== "string") {
    return template;
  }

  // Check if the entire string is a single expression
  const trimmed = template.trim();
  if (
    trimmed.startsWith("{{") &&
    trimmed.endsWith("}}") &&
    countOccurrences(trimmed, "{{") === 1
  ) {
    const expr = trimmed.slice(2, -2).trim();
    return evaluateExpression(expr, context);
  }

  // Mixed template: interpolate all expressions as strings
  return template.replace(EXPRESSION_REGEX, (_match, expr: string) => {
    const value = evaluateExpression(expr.trim(), context);
    if (value === undefined || value === null) {
      return "";
    }
    if (typeof value === "object") {
      return JSON.stringify(value);
    }
    return String(value);
  });
}

/**
 * Resolve expressions recursively in an object/array structure.
 */
export function resolveExpressionsDeep(
  value: unknown,
  context: ExpressionContext
): unknown {
  if (typeof value === "string") {
    return resolveExpressions(value, context);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveExpressionsDeep(item, context));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = resolveExpressionsDeep(val, context);
    }
    return result;
  }
  return value;
}

/**
 * Evaluate a single expression string (without {{ }}).
 */
function evaluateExpression(expr: string, context: ExpressionContext): unknown {
  // Handle ?? default value operator — only split on FIRST ??
  const nullishIndex = expr.indexOf("??");
  let mainExpr: string;
  let defaultExpr: string | undefined;

  if (nullishIndex >= 0) {
    mainExpr = expr.slice(0, nullishIndex).trim();
    defaultExpr = expr.slice(nullishIndex + 2).trim();
  } else {
    mainExpr = expr.trim();
    defaultExpr = undefined;
  }

  const value = resolveReference(mainExpr, context);

  if ((value === undefined || value === null) && defaultExpr !== undefined) {
    // Try to parse default as a literal
    return parseLiteral(defaultExpr);
  }

  return value;
}

/**
 * Resolve a dotted reference path.
 */
function resolveReference(path: string, context: ExpressionContext): unknown {
  const parts = path.split(".");

  if (parts.length < 2) {
    return undefined;
  }

  const scope = parts[0]!;
  const rest = parts.slice(1).join(".");

  switch (scope) {
    case "input":
      return getNestedValue(context.inputs, rest);

    case "vars":
      return getNestedValue(context.variables, rest);

    case "env":
      return context.env[rest];

    default:
      // Treat as nodeId.portId reference
      const nodeOutput = context.nodeOutputs.get(scope);
      if (nodeOutput === undefined) {
        return undefined;
      }
      if (typeof nodeOutput === "object" && nodeOutput !== null) {
        return getNestedValue(nodeOutput as Record<string, unknown>, rest);
      }
      return parts.length === 2 ? nodeOutput : undefined;
  }
}

/**
 * Get a nested value from an object using dot notation.
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Parse a literal value from a default expression.
 */
function parseLiteral(value: string): unknown {
  // String literal (quoted)
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  // Number
  const num = Number(value);
  if (!isNaN(num)) {
    return num;
  }

  // Boolean
  if (value === "true") return true;
  if (value === "false") return false;

  // Null
  if (value === "null") return null;

  // Return as-is (string)
  return value;
}

function countOccurrences(str: string, substr: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = str.indexOf(substr, pos)) !== -1) {
    count++;
    pos += substr.length;
  }
  return count;
}
