/**
 * Click-to-select picker for locally detected CLI apps (terminal module).
 */

import { useEffect, useState } from "react";
import { api, type DetectedCliApp } from "../api/client";

interface CliAppPickerProps {
  selectedCommand: string;
  onSelect: (app: DetectedCliApp) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  agent: "AI Agent",
  runtime: "运行时",
  "package-manager": "包管理",
  tool: "工具",
};

export function CliAppPicker({ selectedCommand, onSelect }: CliAppPickerProps) {
  const [apps, setApps] = useState<DetectedCliApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.terminal
      .listApps()
      .then((res) => {
        if (!cancelled) {
          setApps(res.apps);
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

  if (loading) {
    return (
      <div style={{ fontSize: 11, color: "var(--color-text-muted)", padding: "8px 0" }}>
        正在扫描本机可连接应用…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ fontSize: 11, color: "#dc2626", padding: "8px 0" }}>
        扫描失败: {error}
      </div>
    );
  }

  const detected = apps.filter((a) => a.detected);
  const notDetected = apps.filter((a) => !a.detected);
  const visible = showAll ? apps : detected;

  if (detected.length === 0) {
    return (
      <div
        style={{
          padding: 12,
          borderRadius: 6,
          background: "#fef3c7",
          border: "1px solid #fcd34d",
          fontSize: 11,
          color: "#92400e",
        }}
      >
        <strong>未检测到已安装的 CLI 应用。</strong>
        <p style={{ margin: "6px 0 0" }}>
          请先安装 Claude Code、Python、Node 等，并确保已加入系统 PATH。也可在下方手动输入命令。
        </p>
        <button
          type="button"
          className="btn"
          style={{ marginTop: 8, fontSize: 11 }}
          onClick={() => setShowAll(true)}
        >
          显示全部预设 ({apps.length})
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text)" }}>
          本机应用（{detected.length} 个可用）
        </span>
        {notDetected.length > 0 && (
          <button
            type="button"
            style={{
              fontSize: 10,
              color: "var(--color-text-muted)",
              background: "none",
              border: "none",
              cursor: "pointer",
              textDecoration: "underline",
            }}
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "仅显示已安装" : `显示未安装 (${notDetected.length})`}
          </button>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: 8,
          maxHeight: 220,
          overflowY: "auto",
        }}
      >
        {visible.map((app) => {
          const isSelected =
            selectedCommand.trim() === app.command.trim() ||
            (app.path && selectedCommand.includes(app.resolvedBinary ?? ""));
          const disabled = !app.detected;

          return (
            <button
              key={app.id}
              type="button"
              disabled={disabled}
              title={
                app.detected
                  ? `${app.description}\n路径: ${app.path}`
                  : `${app.description}\n（未安装）`
              }
              onClick={() => onSelect(app)}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 4,
                padding: "10px 10px",
                borderRadius: 8,
                border: isSelected
                  ? "2px solid #3b82f6"
                  : "1px solid var(--color-border)",
                background: isSelected ? "#eff6ff" : disabled ? "#f8fafc" : "white",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.55 : 1,
                textAlign: "left",
                transition: "border-color 0.15s, background 0.15s",
              }}
            >
              <span style={{ fontSize: 18, lineHeight: 1 }}>{app.icon ?? "⌨"}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text)" }}>
                {app.name}
              </span>
              <span
                style={{
                  fontSize: 9,
                  color: "var(--color-text-muted)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {app.command}
              </span>
              <span
                style={{
                  fontSize: 9,
                  padding: "1px 5px",
                  borderRadius: 4,
                  background: "var(--color-surface-alt)",
                  color: "var(--color-text-muted)",
                }}
              >
                {CATEGORY_LABELS[app.category] ?? app.category}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
