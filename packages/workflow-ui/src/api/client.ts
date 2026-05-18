/**
 * API client for the workflow server.
 */

const BASE_URL = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((error as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WorkflowSummary {
  id: string;
  name: string;
  description?: string;
  version: string;
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  version: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables: unknown[];
  triggers: unknown[];
  settings: WorkflowSettings;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    label: string;
    config: Record<string, unknown>;
    inputs: PortDef[];
    outputs: PortDef[];
  };
  settings?: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  condition?: string;
}

export interface PortDef {
  id: string;
  name: string;
  type: string;
  required?: boolean;
}

export interface WorkflowSettings {
  maxExecutionTime: number;
  maxNodeRetries: number;
  errorStrategy: string;
  concurrencyLimit: number;
}

export interface ModuleMeta {
  id: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  inputs: PortDef[];
  outputs: PortDef[];
  configSchema: Record<string, unknown>;
}

export interface ExecutionResult {
  executionId: string;
  status: string;
  metrics: {
    totalNodes: number;
    completedNodes: number;
    failedNodes: number;
    skippedNodes: number;
    totalDuration?: number;
  };
  outputs?: Record<string, unknown>;
  errors?: Array<{ nodeId: string; message: string }>;
}

export interface CredentialSummary {
  id: string;
  type: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialRef {
  __credentialRef: true;
  credentialId: string;
  field?: string;
}

export function isCredentialRef(value: unknown): value is CredentialRef {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).__credentialRef === true &&
    typeof (value as CredentialRef).credentialId === "string"
  );
}

export function makeCredentialRef(credentialId: string, field?: string): CredentialRef {
  const ref: CredentialRef = { __credentialRef: true, credentialId };
  if (field) ref.field = field;
  return ref;
}

// ─── API Methods ────────────────────────────────────────────────────────────

export const api = {
  workflows: {
    list: () => request<WorkflowSummary[]>("/workflows"),
    get: (id: string) => request<Workflow>(`/workflows/${id}`),
    create: (data: Partial<Workflow>) => request<Workflow>("/workflows", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Workflow>) => request<Workflow>(`/workflows/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/workflows/${id}`, { method: "DELETE" }),
    clone: (id: string) => request<Workflow>(`/workflows/${id}/clone`, { method: "POST" }),
    validate: (id: string) => request<{ valid: boolean; entryNodes?: string[]; executionOrder?: string[]; message?: string }>(`/workflows/${id}/validate`, { method: "POST" }),
    execute: (id: string, inputs?: Record<string, unknown>) => request<ExecutionResult>(`/workflows/${id}/execute`, { method: "POST", body: JSON.stringify({ inputs }) }),
  },
  modules: {
    list: () => request<ModuleMeta[]>("/modules"),
    get: (id: string) => request<ModuleMeta>(`/modules/${id}`),
  },
  credentials: {
    list: () => request<CredentialSummary[]>("/credentials"),
    get: (id: string) => request<CredentialSummary>(`/credentials/${id}`),
    create: (data: { type: string; name: string; description?: string; data: Record<string, unknown> }) =>
      request<CredentialSummary>("/credentials", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, patch: { name?: string; description?: string; data?: Record<string, unknown> }) =>
      request<CredentialSummary>(`/credentials/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
    delete: (id: string) => request<void>(`/credentials/${id}`, { method: "DELETE" }),
  },
};
