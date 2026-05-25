/**
 * Credentials management panel — modal dialog for CRUD on stored credentials.
 *
 * UX:
 * - List shows summaries (name, type, last updated) — no secrets
 * - Create/Edit form takes type, name, and a JSON editor for the data payload
 * - Delete confirms before sending request
 * - Common credential types are presented as templates with predefined fields
 */

import { useEffect, useState } from "react";
import { api, type CredentialSummary } from "../api/client";

interface CredentialsPanelProps {
  open: boolean;
  onClose: () => void;
}

interface CredentialTemplate {
  type: string;
  label: string;
  description: string;
  fields: Array<{ key: string; label: string; placeholder: string; secret?: boolean }>;
}

const TEMPLATES: CredentialTemplate[] = [
  {
    type: "openai-api-key",
    label: "OpenAI / OpenAI 兼容 API",
    description: "OpenAI、DeepSeek、Groq、Together AI、Ollama 等兼容 API",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "sk-...", secret: true },
      { key: "baseUrl", label: "API 地址", placeholder: "https://api.openai.com/v1" },
    ],
  },
  {
    type: "anthropic-api-key",
    label: "Anthropic Claude",
    description: "直连 Anthropic 官方 API",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "sk-ant-...", secret: true },
    ],
  },
  {
    type: "http-basic-auth",
    label: "HTTP Basic Auth",
    description: "HTTP 基础认证（用户名 + 密码）",
    fields: [
      { key: "username", label: "用户名", placeholder: "" },
      { key: "password", label: "密码", placeholder: "", secret: true },
    ],
  },
  {
    type: "http-bearer",
    label: "HTTP Bearer Token",
    description: "Authorization: Bearer <token>",
    fields: [
      { key: "token", label: "Token", placeholder: "", secret: true },
    ],
  },
  {
    type: "custom",
    label: "自定义（JSON）",
    description: "任意 JSON 结构，用于不在模板里的服务",
    fields: [],
  },
];

export function CredentialsPanel({ open, onClose }: CredentialsPanelProps) {
  const [list, setList] = useState<CredentialSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<{ mode: "create" | "edit"; id?: string } | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      setList(await api.credentials.list());
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`确定删除凭据 "${name}"？删除后引用该凭据的工作流会执行失败。`)) return;
    try {
      await api.credentials.delete(id);
      refresh();
    } catch (err) {
      alert(`删除失败: ${err instanceof Error ? err.message : err}`);
    }
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "white",
          borderRadius: 12,
          width: 640,
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>🔐 凭据管理</h2>
            <p style={{ fontSize: 11, color: "var(--color-text-muted)", margin: "4px 0 0" }}>
              API Key、密码等敏感信息加密存储；工作流通过引用使用，不存明文
            </p>
          </div>
          {!editing && (
            <button
              onClick={() => setEditing({ mode: "create" })}
              style={{ padding: "6px 14px", fontSize: 12, borderRadius: 6, background: "var(--color-primary)", color: "white", border: "none", cursor: "pointer", marginRight: 8 }}
            >
              + 新建
            </button>
          )}
          <button
            onClick={onClose}
            style={{ fontSize: 18, border: "none", background: "transparent", cursor: "pointer", color: "var(--color-text-muted)", padding: "0 4px" }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
          {editing ? (
            <CredentialForm
              mode={editing.mode}
              credentialId={editing.id}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                refresh();
              }}
            />
          ) : (
            <CredentialList list={list} loading={loading} onEdit={(id) => setEditing({ mode: "edit", id })} onDelete={handleDelete} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── List ───────────────────────────────────────────────────────────────────

interface ListProps {
  list: CredentialSummary[];
  loading: boolean;
  onEdit: (id: string) => void;
  onDelete: (id: string, name: string) => void;
}

function CredentialList({ list, loading, onEdit, onDelete }: ListProps) {
  if (loading) {
    return <p style={{ textAlign: "center", color: "var(--color-text-muted)", fontSize: 12, padding: 20 }}>加载中...</p>;
  }
  if (list.length === 0) {
    return (
      <p style={{ textAlign: "center", color: "var(--color-text-muted)", fontSize: 12, padding: 20 }}>
        暂无凭据。点击右上角"新建"添加第一个。
      </p>
    );
  }
  return (
    <div>
      {list.map((c) => (
        <div
          key={c.id}
          style={{
            padding: "12px 14px",
            borderRadius: 8,
            border: "1px solid var(--color-border)",
            marginBottom: 8,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{c.name}</div>
            <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
              <span style={{ background: "var(--color-surface-alt)", padding: "1px 6px", borderRadius: 3, marginRight: 6 }}>{c.type}</span>
              {c.description ?? "无描述"}
            </div>
            <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 4 }}>
              ID: <code style={{ fontSize: 10 }}>{c.id}</code> · 更新于 {new Date(c.updatedAt).toLocaleString()}
            </div>
          </div>
          <button
            onClick={() => onEdit(c.id)}
            style={{ fontSize: 11, padding: "4px 10px", border: "1px solid var(--color-border)", borderRadius: 4, background: "white", cursor: "pointer" }}
          >
            编辑
          </button>
          <button
            onClick={() => onDelete(c.id, c.name)}
            style={{ fontSize: 11, padding: "4px 8px", border: "1px solid #fecaca", borderRadius: 4, color: "#dc2626", background: "white", cursor: "pointer" }}
          >
            删除
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Form ───────────────────────────────────────────────────────────────────

interface FormProps {
  mode: "create" | "edit";
  credentialId?: string;
  onCancel: () => void;
  onSaved: () => void;
}

function CredentialForm({ mode, credentialId, onCancel, onSaved }: FormProps) {
  const [type, setType] = useState<string>("openai-api-key");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fieldsValues, setFieldsValues] = useState<Record<string, string>>({});
  const [customJson, setCustomJson] = useState<string>("{}");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(mode === "create");

  useEffect(() => {
    if (mode === "edit" && credentialId) {
      api.credentials
        .get(credentialId)
        .then((c) => {
          setType(c.type);
          setName(c.name);
          setDescription(c.description ?? "");
          setLoaded(true);
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    }
  }, [mode, credentialId]);

  const template = TEMPLATES.find((t) => t.type === type) ?? TEMPLATES[TEMPLATES.length - 1]!;

  const handleSave = async () => {
    setError(null);

    if (!name.trim()) {
      setError("请填写名称");
      return;
    }

    let data: Record<string, unknown>;
    if (template.type === "custom") {
      try {
        data = JSON.parse(customJson);
        if (typeof data !== "object" || data === null) throw new Error("must be a JSON object");
      } catch (err) {
        setError(`自定义 JSON 无效: ${err instanceof Error ? err.message : err}`);
        return;
      }
    } else {
      data = {};
      for (const f of template.fields) {
        const v = fieldsValues[f.key];
        if (v !== undefined && v !== "") data[f.key] = v;
      }
      if (mode === "create" && Object.keys(data).length === 0) {
        setError("请填写至少一个字段");
        return;
      }
    }

    setSaving(true);
    try {
      if (mode === "create") {
        await api.credentials.create({ type, name, description, data });
      } else if (credentialId) {
        const patch: { name: string; description: string; data?: Record<string, unknown> } = {
          name,
          description,
        };
        // Only include data if user typed something — empty fields = "don't change"
        const hasNewData =
          template.type === "custom"
            ? customJson.trim() !== "{}" && customJson.trim() !== ""
            : Object.values(fieldsValues).some((v) => v && v.length > 0);
        if (hasNewData) patch.data = data;
        await api.credentials.update(credentialId, patch);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return <p style={{ textAlign: "center", color: "var(--color-text-muted)", fontSize: 12 }}>加载中...</p>;
  }

  return (
    <div>
      <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 12px" }}>
        {mode === "create" ? "新建凭据" : "编辑凭据"}
      </h3>

      {/* Type */}
      <Field label="类型" required>
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setFieldsValues({});
          }}
          disabled={mode === "edit"}
          style={inputStyle}
        >
          {TEMPLATES.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </select>
        <small style={hintStyle}>{template.description}</small>
        {mode === "edit" && <small style={hintStyle}>编辑模式下类型不可修改</small>}
      </Field>

      {/* Name */}
      <Field label="名称" required>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：OpenAI 生产环境"
          style={inputStyle}
        />
      </Field>

      {/* Description */}
      <Field label="描述（可选）">
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="便于团队识别这个凭据的用途"
          style={inputStyle}
        />
      </Field>

      {/* Data fields */}
      {template.type === "custom" ? (
        <Field label="数据（JSON）" required={mode === "create"}>
          <textarea
            value={customJson}
            onChange={(e) => setCustomJson(e.target.value)}
            rows={8}
            style={{ ...inputStyle, fontFamily: "monospace", fontSize: 11, resize: "vertical" }}
            placeholder='{ "apiKey": "...", "secret": "..." }'
          />
          {mode === "edit" && <small style={hintStyle}>留空则保留原数据不变</small>}
        </Field>
      ) : (
        <>
          {template.fields.map((f) => (
            <Field key={f.key} label={f.label} required={mode === "create"}>
              <input
                type={f.secret ? "password" : "text"}
                value={fieldsValues[f.key] ?? ""}
                onChange={(e) => setFieldsValues({ ...fieldsValues, [f.key]: e.target.value })}
                placeholder={mode === "edit" ? "留空保留原值" : f.placeholder}
                style={inputStyle}
                autoComplete="off"
              />
            </Field>
          ))}
        </>
      )}

      {error && (
        <div style={{ background: "#fee2e2", color: "#991b1b", padding: "8px 12px", borderRadius: 4, fontSize: 12, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {/* Buttons */}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
        <button
          onClick={onCancel}
          disabled={saving}
          style={{ padding: "6px 14px", fontSize: 12, borderRadius: 6, background: "white", border: "1px solid var(--color-border)", cursor: "pointer" }}
        >
          取消
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{ padding: "6px 14px", fontSize: 12, borderRadius: 6, background: "var(--color-primary)", color: "white", border: "none", cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.5 : 1 }}
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
    </div>
  );
}

// ─── UI helpers ─────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  fontSize: 12,
  border: "1px solid var(--color-border)",
  borderRadius: 4,
  outline: "none",
  background: "white",
  boxSizing: "border-box",
};

const hintStyle: React.CSSProperties = {
  display: "block",
  fontSize: 10,
  color: "var(--color-text-muted)",
  marginTop: 3,
};

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text)", display: "block", marginBottom: 4 }}>
        {label}
        {required && <span style={{ color: "#ef4444", fontSize: 10, marginLeft: 4 }}>*</span>}
      </label>
      {children}
    </div>
  );
}
