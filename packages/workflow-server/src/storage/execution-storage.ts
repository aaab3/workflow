/**
 * Execution history persistence — saves execution results to disk
 * and provides retrieval/cleanup capabilities.
 */

import { readFile, writeFile, readdir, unlink, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface ExecutionRecord {
  executionId: string;
  workflowId: string;
  status: string;
  startTime: number;
  endTime?: number;
  metrics: {
    totalNodes: number;
    completedNodes: number;
    failedNodes: number;
    skippedNodes: number;
    totalDuration?: number;
  };
  outputs?: Record<string, unknown>;
  errors?: Array<{ nodeId: string; message: string; code: string }>;
}

const MAX_EXECUTIONS = 100;

export class ExecutionStorage {
  private readonly dir: string;

  constructor(workflowDir: string) {
    this.dir = join(workflowDir, ".executions");
  }

  /**
   * Ensure the storage directory exists.
   */
  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  /**
   * Save an execution result to disk.
   */
  async save(record: ExecutionRecord): Promise<void> {
    await this.init();
    const filePath = join(this.dir, `${record.executionId}.json`);
    await writeFile(filePath, JSON.stringify(record, null, 2), "utf-8");
    await this.cleanup();
  }

  /**
   * Load a single execution by ID.
   */
  async get(executionId: string): Promise<ExecutionRecord | null> {
    const filePath = join(this.dir, `${executionId}.json`);
    try {
      const content = await readFile(filePath, "utf-8");
      return JSON.parse(content) as ExecutionRecord;
    } catch {
      return null;
    }
  }

  /**
   * List recent executions (sorted by startTime descending).
   */
  async list(limit = 50): Promise<ExecutionRecord[]> {
    await this.init();
    const files = await readdir(this.dir);
    const records: ExecutionRecord[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const content = await readFile(join(this.dir, file), "utf-8");
        records.push(JSON.parse(content) as ExecutionRecord);
      } catch {
        // Skip invalid files
      }
    }

    // Sort by start time descending
    records.sort((a, b) => b.startTime - a.startTime);

    return records.slice(0, limit);
  }

  /**
   * Auto-cleanup: keep only the last MAX_EXECUTIONS files.
   */
  private async cleanup(): Promise<void> {
    try {
      const files = await readdir(this.dir);
      const jsonFiles = files.filter((f) => f.endsWith(".json"));

      if (jsonFiles.length <= MAX_EXECUTIONS) return;

      // Get file stats for sorting by modification time
      const fileStats = await Promise.all(
        jsonFiles.map(async (file) => {
          const filePath = join(this.dir, file);
          try {
            const s = await stat(filePath);
            return { file, mtime: s.mtimeMs };
          } catch {
            return { file, mtime: 0 };
          }
        })
      );

      // Sort oldest first
      fileStats.sort((a, b) => a.mtime - b.mtime);

      // Remove oldest files beyond the limit
      const toRemove = fileStats.slice(0, fileStats.length - MAX_EXECUTIONS);
      await Promise.allSettled(
        toRemove.map(({ file }) => unlink(join(this.dir, file)))
      );
    } catch {
      // Cleanup is best-effort
    }
  }
}
