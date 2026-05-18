/**
 * Module schema utilities — bridges Zod runtime validation with the existing
 * JSON Schema 7 metadata format used by the UI.
 *
 * Why both?
 * - Zod is the source of truth for runtime validation and TS types.
 * - JSON Schema is what the UI's SchemaForm consumes (zod-to-json-schema converts).
 *
 * Modules can use either:
 * - New: `configZod: z.ZodType` (preferred — runtime validation + type inference)
 * - Old: `configSchema: Record<string, unknown>` (JSON Schema literal, no runtime check)
 *
 * The engine prefers Zod when both are present.
 */

import { z, ZodType, ZodError } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// ─── Detection ──────────────────────────────────────────────────────────────

/**
 * Detect whether a value is a Zod schema. We can't use `instanceof ZodType`
 * across module boundaries reliably (multiple zod copies in a monorepo), so
 * we duck-type check the safeParse method.
 */
export function isZodSchema(value: unknown): value is ZodType {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { safeParse?: unknown }).safeParse === "function" &&
    typeof (value as { parse?: unknown }).parse === "function"
  );
}

// ─── JSON Schema generation ─────────────────────────────────────────────────

/**
 * Convert a Zod schema to a JSON Schema 7 object suitable for the UI's
 * SchemaForm. Strips $schema, $ref, definitions to keep the output minimal.
 */
export function zodToConfigSchema(schema: ZodType): Record<string, unknown> {
  const json = zodToJsonSchema(schema, {
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;

  // Drop the `$schema` declaration to match the existing format
  delete json.$schema;
  delete json.$ref;
  return json;
}

// ─── Validation ─────────────────────────────────────────────────────────────

export interface ValidationOk<T> {
  ok: true;
  data: T;
}

export interface ValidationFail {
  ok: false;
  errors: Array<{ path: string; message: string; code?: string }>;
}

export type ValidationResult<T> = ValidationOk<T> | ValidationFail;

/**
 * Validate an input against a Zod schema. Returns a structured result so
 * callers don't need try/catch.
 *
 * Important: this also APPLIES DEFAULT VALUES — if the schema says
 * `z.number().default(30)` and input is missing, the parsed value will be 30.
 */
export function validateWithZod<T>(schema: ZodType<T>, input: unknown): ValidationResult<T> {
  const result = schema.safeParse(input);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return {
    ok: false,
    errors: zodErrorToList(result.error),
  };
}

function zodErrorToList(err: ZodError): Array<{ path: string; message: string; code?: string }> {
  return err.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  }));
}

// ─── Helpers for common config field patterns ──────────────────────────────

/**
 * A Zod schema for the credential reference object stored in config.
 * Modules using `format: credential` UI fields receive a CredentialRef in
 * the raw workflow JSON, but the engine resolves it to the plaintext value
 * before execute, so module config schemas should typically expect a string.
 */
export const credentialRefSchema = z.object({
  __credentialRef: z.literal(true),
  credentialId: z.string(),
  field: z.string().optional(),
});

/**
 * Helper to create a "credential or string" union — useful when a module
 * accepts either a literal value (for testing/local dev) or a CredentialRef.
 * After engine credential resolution, the value is always a string at execute time.
 */
export function credentialField(): z.ZodType<string> {
  // At runtime (after engine resolution), the value is always a plain string.
  // The Zod type reflects what execute() actually sees.
  return z.string();
}

/**
 * Format an error list as a single human-readable string.
 */
export function formatValidationErrors(errors: ValidationFail["errors"]): string {
  return errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message)).join("; ");
}
