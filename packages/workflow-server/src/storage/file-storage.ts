/**
 * File-system based workflow storage.
 * Workflows are stored as individual JSON files in a directory.
 */

import { readFile, writeFile, readdir, unlink, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Workflow } from "@openclaw/workflow-engine";

export interface WorkflowStorage {
  list(): Promise<Workflow[]>;
  get(id: string): Promise<Workflow | null>;
  create(workflow: Workflow): Promise<Workflow>;
  update(id: string, workflow: Partial<Workflow>): Promise<Workflow>;
  delete(id: string): Promise<boolean>;
}

export class FileWorkflowStorage implements WorkflowStorage {
  constructor(private readonly dir: string) {}

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  async list(): Promise<Workflow[]> {
    await this.init();
    const files = await readdir(this.dir);
    const workflows: Workflow[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const content = await readFile(join(this.dir, file), "utf-8");
        workflows.push(JSON.parse(content) as Workflow);
      } catch {
        // Skip invalid files
      }
    }

    return workflows;
  }

  async get(id: string): Promise<Workflow | null> {
    const filePath = this.getFilePath(id);
    try {
      const content = await readFile(filePath, "utf-8");
      return JSON.parse(content) as Workflow;
    } catch {
      return null;
    }
  }

  async create(workflow: Workflow): Promise<Workflow> {
    await this.init();
    const now = new Date().toISOString();
    const wf: Workflow = {
      ...workflow,
      createdAt: workflow.createdAt || now,
      updatedAt: now,
    };
    await writeFile(this.getFilePath(wf.id), JSON.stringify(wf, null, 2), "utf-8");
    return wf;
  }

  async update(id: string, partial: Partial<Workflow>): Promise<Workflow> {
    const existing = await this.get(id);
    if (!existing) {
      throw new Error(`Workflow not found: ${id}`);
    }

    const updated: Workflow = {
      ...existing,
      ...partial,
      id, // ID cannot be changed
      updatedAt: new Date().toISOString(),
    };

    await writeFile(this.getFilePath(id), JSON.stringify(updated, null, 2), "utf-8");
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const filePath = this.getFilePath(id);
    try {
      await stat(filePath);
      await unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private getFilePath(id: string): string {
    // Sanitize ID for filesystem safety
    const safe = id.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.dir, `${safe}.json`);
  }
}
