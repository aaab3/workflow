/**
 * Undo/Redo history for workflow editor.
 * Stores snapshots of nodes and edges state.
 */

import type { Node, Edge } from "@xyflow/react";

interface HistoryEntry {
  nodes: Node[];
  edges: Edge[];
}

const MAX_HISTORY = 50;

class UndoRedoHistory {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private current: HistoryEntry = { nodes: [], edges: [] };
  private paused = false;

  /** Initialize with current state */
  init(nodes: Node[], edges: Edge[]) {
    this.current = { nodes: structuredClone(nodes), edges: structuredClone(edges) };
    this.past = [];
    this.future = [];
  }

  /** Push current state to history before making a change */
  push(nodes: Node[], edges: Edge[]) {
    if (this.paused) return;

    this.past.push(this.current);
    if (this.past.length > MAX_HISTORY) {
      this.past.shift();
    }
    this.current = { nodes: structuredClone(nodes), edges: structuredClone(edges) };
    this.future = []; // Clear redo stack on new action
  }

  /** Undo: restore previous state */
  undo(): HistoryEntry | null {
    if (this.past.length === 0) return null;

    this.future.push(this.current);
    this.current = this.past.pop()!;
    return structuredClone(this.current);
  }

  /** Redo: restore next state */
  redo(): HistoryEntry | null {
    if (this.future.length === 0) return null;

    this.past.push(this.current);
    this.current = this.future.pop()!;
    return structuredClone(this.current);
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  /** Pause history recording (for batch operations) */
  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }
}

export const history = new UndoRedoHistory();
