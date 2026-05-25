/**
 * Live workflow execution state — SSE-driven progress + final result.
 */

import { create } from "zustand";
import {
  api,
  type ExecutionDetail,
  type ExecutionResult,
  type EngineEvent,
} from "../api/client";
import { subscribeExecutionStream } from "../api/execution-stream";
import { useWorkflowStore } from "./workflow-store";

export type NodeExecStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface ExecutionLogLine {
  id: string;
  timestamp: number;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  nodeId?: string;
}

interface ExecutionState {
  isRunning: boolean;
  executionId: string | null;
  status: string | null;
  metrics: ExecutionResult["metrics"] | null;
  nodeStatuses: Record<string, NodeExecStatus>;
  logs: ExecutionLogLine[];
  result: ExecutionResult | null;
  streamError: string | null;
  panelOpen: boolean;

  run: (workflowId: string, inputs?: Record<string, unknown>) => Promise<void>;
  stopWatching: () => void;
  closePanel: () => void;
  openPanel: () => void;
  reset: () => void;
}

let unsubscribeStream: (() => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let finished = false;

function clearTimers(): void {
  unsubscribeStream?.();
  unsubscribeStream = null;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function detailToResult(detail: ExecutionDetail): ExecutionResult {
  const duration =
    detail.endTime != null && detail.startTime != null
      ? detail.endTime - detail.startTime
      : undefined;
  return {
    executionId: detail.executionId,
    status: detail.status,
    metrics: { ...detail.metrics, totalDuration: duration },
    outputs: detail.outputs,
    errors: detail.errors?.map((e) => ({ nodeId: e.nodeId, message: e.message })),
  };
}

function mapNodeStates(
  states: Record<string, { status: string }>
): Record<string, NodeExecStatus> {
  const out: Record<string, NodeExecStatus> = {};
  for (const [id, s] of Object.entries(states)) {
    if (
      s.status === "running" ||
      s.status === "completed" ||
      s.status === "failed" ||
      s.status === "skipped" ||
      s.status === "pending"
    ) {
      out[id] = s.status;
    }
  }
  return out;
}

function applyEvent(
  event: EngineEvent,
  set: (fn: (s: ExecutionState) => Partial<ExecutionState>) => void,
  getLogsLength: () => number
): void {
  const wf = useWorkflowStore.getState();

  if (event.type === "node:start") {
    wf.setNodeExecutionStatus(event.nodeId, "running");
    set((s) => ({ nodeStatuses: { ...s.nodeStatuses, [event.nodeId]: "running" } }));
  } else if (event.type === "node:complete") {
    wf.setNodeExecutionStatus(event.nodeId, "completed");
    set((s) => ({
      nodeStatuses: { ...s.nodeStatuses, [event.nodeId]: "completed" },
      metrics: s.metrics
        ? { ...s.metrics, completedNodes: s.metrics.completedNodes + 1 }
        : s.metrics,
    }));
  } else if (event.type === "node:error" && !event.willRetry) {
    wf.setNodeExecutionStatus(event.nodeId, "failed");
    set((s) => ({
      nodeStatuses: { ...s.nodeStatuses, [event.nodeId]: "failed" },
      metrics: s.metrics ? { ...s.metrics, failedNodes: s.metrics.failedNodes + 1 } : s.metrics,
    }));
  } else if (event.type === "node:skip") {
    wf.setNodeExecutionStatus(event.nodeId, "skipped");
    set((s) => ({
      nodeStatuses: { ...s.nodeStatuses, [event.nodeId]: "skipped" },
      metrics: s.metrics ? { ...s.metrics, skippedNodes: s.metrics.skippedNodes + 1 } : s.metrics,
    }));
  } else if (event.type === "log") {
    const line: ExecutionLogLine = {
      id: `${event.timestamp}-${getLogsLength()}`,
      timestamp: event.timestamp,
      level: event.level,
      message: event.message,
      nodeId: event.nodeId,
    };
    set((s) => ({ logs: [...s.logs, line].slice(-200) }));
  } else if (event.type === "execution:complete") {
    set((s) => ({
      metrics: event.metrics,
      result: {
        executionId: s.executionId ?? "",
        status: "completed",
        metrics: event.metrics,
        outputs: event.outputs,
        errors: s.result?.errors,
      },
    }));
  }
}

function startPollingFallback(
  executionId: string,
  set: (fn: (s: ExecutionState) => Partial<ExecutionState>) => void
): void {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    if (finished) return;
    try {
      const detail = await api.executions.get(executionId);
      if (detail.nodeStates) {
        const wf = useWorkflowStore.getState();
        for (const [nodeId, state] of Object.entries(detail.nodeStates)) {
          const st = state.status as NodeExecStatus;
          if (st === "running" || st === "completed" || st === "failed" || st === "skipped") {
            wf.setNodeExecutionStatus(nodeId, st);
          }
        }
        set(() => ({
          nodeStatuses: mapNodeStates(detail.nodeStates!),
          metrics: detail.metrics,
        }));
      }
      if (detail.status !== "running") {
        finished = true;
        clearTimers();
        const result = detailToResult(detail);
        const logsPayload = await api.executions.logs(executionId).catch(() => null);
        const logsFromDisk =
          logsPayload?.logs?.map((entry, i) => ({
            id: `disk-${entry.timestamp ?? i}-${i}`,
            timestamp: entry.timestamp ?? Date.now(),
            level: (entry.level ?? "info") as ExecutionLogLine["level"],
            message: entry.message ?? "",
            nodeId: entry.nodeId,
          })) ?? [];
        set((s) => ({
          isRunning: false,
          status: detail.status,
          result,
          metrics: result.metrics,
          logs: s.logs.length > 0 ? s.logs : logsFromDisk,
        }));
      }
    } catch {
      /* retry */
    }
  }, 1000);
}

export const useExecutionStore = create<ExecutionState>((set, get) => ({
  isRunning: false,
  executionId: null,
  status: null,
  metrics: null,
  nodeStatuses: {},
  logs: [],
  result: null,
  streamError: null,
  panelOpen: false,

  run: async (workflowId, inputs) => {
    clearTimers();
    finished = false;

    const wf = useWorkflowStore.getState();
    wf.clearExecutionStatuses();
    const initialStatuses = Object.fromEntries(
      wf.nodes.map((n) => {
        wf.setNodeExecutionStatus(n.id, "pending");
        return [n.id, "pending" as NodeExecStatus];
      })
    );

    set({
      isRunning: true,
      executionId: null,
      status: "running",
      metrics: {
        totalNodes: wf.nodes.length,
        completedNodes: 0,
        failedNodes: 0,
        skippedNodes: 0,
      },
      nodeStatuses: initialStatuses,
      logs: [],
      result: null,
      streamError: null,
      panelOpen: true,
    });

    try {
      const start = await api.workflows.executeAsync(workflowId, inputs);
      set({ executionId: start.executionId });

      const finish = async (finalStatus: string) => {
        if (finished) return;
        finished = true;
        clearTimers();
        const detail = await api.executions.get(start.executionId).catch(() => null);
        const logsPayload = await api.executions.logs(start.executionId).catch(() => null);
        const result = detail
          ? detailToResult(detail)
          : {
              executionId: start.executionId,
              status: finalStatus,
              metrics: get().metrics ?? {
                totalNodes: wf.nodes.length,
                completedNodes: 0,
                failedNodes: 0,
                skippedNodes: 0,
              },
              outputs: get().result?.outputs,
            };
        const logsFromDisk =
          logsPayload?.logs?.map((entry, i) => ({
            id: `disk-${entry.timestamp ?? i}-${i}`,
            timestamp: entry.timestamp ?? Date.now(),
            level: (entry.level ?? "info") as ExecutionLogLine["level"],
            message: entry.message ?? "",
            nodeId: entry.nodeId,
          })) ?? [];
        const mergedLogs =
          get().logs.length > 0 ? get().logs : logsFromDisk;
        set({
          isRunning: false,
          status: finalStatus,
          result,
          metrics: result.metrics,
          logs: mergedLogs,
        });
      };

      unsubscribeStream = subscribeExecutionStream(start.executionId, {
        onEvent: (event) => applyEvent(event, set, () => get().logs.length),
        onDone: (status) => void finish(status),
        onError: (message) => {
          set({ streamError: message });
          startPollingFallback(start.executionId, set);
        },
      });
    } catch (err) {
      clearTimers();
      wf.clearExecutionStatuses();
      set({
        isRunning: false,
        status: "failed",
        streamError: err instanceof Error ? err.message : String(err),
        panelOpen: true,
      });
    }
  },

  stopWatching: () => {
    finished = true;
    clearTimers();
    useWorkflowStore.getState().clearExecutionStatuses();
    set({ isRunning: false });
  },

  closePanel: () => set({ panelOpen: false }),
  openPanel: () => set({ panelOpen: true }),

  reset: () => {
    finished = true;
    clearTimers();
    useWorkflowStore.getState().clearExecutionStatuses();
    set({
      isRunning: false,
      executionId: null,
      status: null,
      metrics: null,
      nodeStatuses: {},
      logs: [],
      result: null,
      streamError: null,
      panelOpen: false,
    });
  },
}));
