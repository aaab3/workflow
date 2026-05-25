/**
 * Subscribe to execution events via Server-Sent Events.
 */

import type { EngineEvent } from "./client";

export interface ExecutionStreamHandlers {
  onEvent: (event: EngineEvent) => void;
  onDone: (status: string) => void;
  onError: (message: string) => void;
}

/** Returns cleanup function to close the stream. */
export function subscribeExecutionStream(
  executionId: string,
  handlers: ExecutionStreamHandlers
): () => void {
  const url = `/api/executions/${executionId}/stream`;
  const es = new EventSource(url);

  es.onmessage = (msg) => {
    try {
      const event = JSON.parse(msg.data) as EngineEvent;
      handlers.onEvent(event);
    } catch {
      /* ignore malformed */
    }
  };

  es.addEventListener("done", (msg) => {
    try {
      const data = JSON.parse((msg as MessageEvent).data) as { status: string };
      handlers.onDone(data.status);
    } catch {
      handlers.onDone("completed");
    }
    es.close();
  });

  es.addEventListener("error", (msg) => {
    if (msg instanceof MessageEvent && msg.data) {
      try {
        const data = JSON.parse(msg.data) as { message?: string };
        handlers.onError(data.message ?? "Stream error");
      } catch {
        handlers.onError("Stream error");
      }
    }
    es.close();
  });

  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) return;
    handlers.onError("连接中断");
    es.close();
  };

  return () => es.close();
}
