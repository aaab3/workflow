/**
 * Schema-driven form component.
 * Generates appropriate form controls based on JSON Schema properties.
 * Inspired by n8n's parameter input system and Flowise's node config panels.
 */

interface SchemaProperty {
  type?: string;
  description?: string;
  default?: unknown;
  enum?: string[];
  examples?: string[];
  minimum?: number;
  maximum?: number;
  format?: string;
  /** When format=credential, restrict the credential picker to this type */
  credentialType?: string;
  /** When format=credential, optional field path inside credential payload */
  credentialField?: string;
}

interface SchemaFormProps {
  schema: Record<string, unknown>;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}

export function SchemaForm({ schema, values, onChange }: SchemaFormProps) {
  const properties = (schema.properties ?? {}) as Record<string, SchemaProperty>;
  const required = (schema.required ?? []) as string[];

  return (
    <div>
      {Object.entries(properties).map(([key, prop]) => (
        <FormField
          key={key}
          name={key}
          property={prop}
          value={values[key]}
          required={required.includes(key)}
          onChange={(val) => onChange(key, val)}
        />
      ))}
    </div>
  );
}

interface FormFieldProps {
  name: string;
  property: SchemaProperty;
  value: unknown;
  required: boolean;
  onChange: (value: unknown) => void;
}

function FormField({ name, property, value, required, onChange }: FormFieldProps) {
  const label = name;
  const description = property.description;
  const displayValue = value ?? property.default ?? "";

  return (
    <div style={{ marginBottom: 14 }}>
      <label
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: "var(--color-text)",
          display: "flex",
          alignItems: "center",
          gap: 4,
          marginBottom: 4,
        }}
      >
        {label}
        {required && <span style={{ color: "#ef4444", fontSize: 10 }}>*</span>}
      </label>

      {description && (
        <p style={{ fontSize: 10, color: "var(--color-text-muted)", margin: "0 0 4px" }}>
          {description}
        </p>
      )}

      {renderControl(property, displayValue, onChange)}
    </div>
  );
}

function renderControl(
  property: SchemaProperty,
  value: unknown,
  onChange: (value: unknown) => void
) {
  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "6px 8px",
    fontSize: 12,
    border: "1px solid var(--color-border)",
    borderRadius: 4,
    outline: "none",
    background: "white",
  };

  // CLI app picker — terminal command selection
  if (property.format === "cli-app") {
    return (
      <CliAppField value={String(value ?? "")} onChange={onChange} inputStyle={inputStyle} />
    );
  }

  // Credential picker — for fields holding API keys / passwords
  if (property.format === "credential") {
    return (
      <CredentialPicker
        value={value}
        credentialType={property.credentialType}
        credentialField={property.credentialField}
        onChange={onChange}
      />
    );
  }

  // Enum → Select dropdown
  if (property.enum && property.enum.length > 0) {
    return (
      <select
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle, cursor: "pointer" }}
      >
        <option value="">-- 选择 --</option>
        {property.enum.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }

  // Boolean → Toggle switch
  if (property.type === "boolean") {
    const checked = value === true || value === "true";
    return (
      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          style={{ width: 16, height: 16, cursor: "pointer" }}
        />
        <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
          {checked ? "是" : "否"}
        </span>
      </label>
    );
  }

  // Number → Number input with optional range
  if (property.type === "number" || property.type === "integer") {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="number"
          value={String(value ?? "")}
          min={property.minimum}
          max={property.maximum}
          step={property.type === "integer" ? 1 : 0.1}
          onChange={(e) => {
            const num = e.target.value === "" ? undefined : Number(e.target.value);
            onChange(num);
          }}
          style={{ ...inputStyle, flex: 1 }}
        />
        {property.minimum !== undefined && property.maximum !== undefined && (
          <input
            type="range"
            min={property.minimum}
            max={property.maximum}
            step={property.type === "integer" ? 1 : 0.1}
            value={Number(value ?? property.default ?? property.minimum)}
            onChange={(e) => onChange(Number(e.target.value))}
            style={{ flex: 1, cursor: "pointer" }}
          />
        )}
      </div>
    );
  }

  // Array (messages) → JSON textarea
  if (property.type === "array") {
    const jsonStr = typeof value === "string" ? value : JSON.stringify(value ?? [], null, 2);
    return (
      <textarea
        value={jsonStr}
        onChange={(e) => {
          try {
            onChange(JSON.parse(e.target.value));
          } catch {
            onChange(e.target.value);
          }
        }}
        rows={4}
        style={{ ...inputStyle, fontFamily: "monospace", fontSize: 11, resize: "vertical" }}
        placeholder="JSON 数组..."
      />
    );
  }

  // String with format "code" or name contains "code" → Code textarea
  if (property.format === "code" || /code|script|expression/i.test(String(property.description ?? ""))) {
    return (
      <textarea
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        rows={8}
        style={{ ...inputStyle, fontFamily: "'Fira Code', 'Cascadia Code', monospace", fontSize: 11, resize: "vertical", lineHeight: 1.5 }}
        placeholder="输入代码..."
      />
    );
  }

  // Multiline text (prompts, text-input content, etc.)
  if (/prompt|content|body|message|template|^text$/i.test(String(property.description ?? "") + name)) {
    return (
      <textarea
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        style={{ ...inputStyle, resize: "vertical" }}
        placeholder={property.description ?? ""}
      />
    );
  }

  // Default → Text input (with optional datalist suggestions from `examples`)
  if (property.examples && property.examples.length > 0) {
    const datalistId = `examples-${Math.random().toString(36).slice(2, 9)}`;
    return (
      <>
        <input
          type="text"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          list={datalistId}
          style={inputStyle}
          placeholder={property.description ?? ""}
        />
        <datalist id={datalistId}>
          {property.examples.map((opt) => (
            <option key={opt} value={opt} />
          ))}
        </datalist>
      </>
    );
  }

  return (
    <input
      type="text"
      value={String(value ?? "")}
      onChange={(e) => onChange(e.target.value)}
      style={inputStyle}
      placeholder={property.description ?? ""}
    />
  );
}

// ─── CLI app field (picker + manual command) ─────────────────────────────────

import { useEffect, useState } from "react";
import { api, type CredentialSummary, type DetectedCliApp, isCredentialRef, makeCredentialRef } from "../api/client";
import { CliAppPicker } from "./CliAppPicker";

function CliAppField({
  value,
  onChange,
  inputStyle,
}: {
  value: string;
  onChange: (value: unknown) => void;
  inputStyle: React.CSSProperties;
}) {
  return (
    <div>
      <CliAppPicker
        selectedCommand={value}
        onSelect={(app: DetectedCliApp) => {
          onChange(app.command);
        }}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontSize: 11 }}
        placeholder="或手动输入命令，如 claude -p"
      />
    </div>
  );
}

// ─── Credential picker ──────────────────────────────────────────────────────

interface CredentialPickerProps {
  value: unknown;
  credentialType?: string;
  credentialField?: string;
  onChange: (value: unknown) => void;
}

/**
 * A select control bound to the credentials API. The value stored in the
 * config is a CredentialRef object (not the plaintext secret).
 */
function CredentialPicker({ value, credentialType, credentialField, onChange }: CredentialPickerProps) {
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.credentials
      .list()
      .then((list) => {
        if (!cancelled) {
          setCredentials(list);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = credentialType
    ? credentials.filter((c) => c.type === credentialType)
    : credentials;

  const selectedId = isCredentialRef(value) ? value.credentialId : "";

  const pickerStyle: React.CSSProperties = {
    width: "100%",
    padding: "6px 8px",
    fontSize: 12,
    border: "1px solid var(--color-border)",
    borderRadius: 4,
    outline: "none",
    background: "white",
    cursor: "pointer",
  };

  if (loading) {
    return <div style={{ fontSize: 11, color: "var(--color-text-muted)", padding: "6px 0" }}>加载凭据中...</div>;
  }
  if (error) {
    return <div style={{ fontSize: 11, color: "#dc2626", padding: "6px 0" }}>加载凭据失败: {error}</div>;
  }

  return (
    <div>
      <select
        value={selectedId}
        onChange={(e) => {
          const id = e.target.value;
          onChange(id ? makeCredentialRef(id, credentialField) : undefined);
        }}
        style={pickerStyle}
      >
        <option value="">-- 选择凭据 --</option>
        {filtered.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.type})
          </option>
        ))}
      </select>
      {filtered.length === 0 && (
        <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 4 }}>
          {credentialType ? `没有 ${credentialType} 类型的凭据` : "还没有凭据"}。在工具栏点击"🔐 凭据"按钮新建。
        </div>
      )}
      {selectedId && (
        <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 4 }}>
          引用 ID: <code>{selectedId}</code>
          {credentialField && <> · 字段: <code>{credentialField}</code></>}
        </div>
      )}
    </div>
  );
}
