/**
 * Module registry - manages registration and lookup of workflow modules.
 */

import { isZodSchema, zodToConfigSchema } from "./module-schema.js";
import type { ModuleHandler, ModuleMeta, ModuleCategory } from "./types.js";

export class ModuleRegistry {
  private modules = new Map<string, ModuleHandler>();

  /**
   * Register a module handler. If the handler defines `configZod`, its meta
   * `configSchema` is automatically populated from the Zod schema (overwriting
   * any literal value already there).
   */
  register(handler: ModuleHandler): void {
    if (this.modules.has(handler.meta.id)) {
      throw new Error(`Module already registered: ${handler.meta.id}`);
    }

    // Auto-derive configSchema from configZod if provided
    if (handler.configZod && isZodSchema(handler.configZod)) {
      const derived = zodToConfigSchema(handler.configZod);
      // Mutate meta in place so listMeta() reports the derived schema
      handler.meta = { ...handler.meta, configSchema: derived };
    }

    this.modules.set(handler.meta.id, handler);
  }

  /**
   * Get a module handler by ID.
   */
  get(moduleId: string): ModuleHandler | undefined {
    return this.modules.get(moduleId);
  }

  /**
   * Get a module handler by ID, throwing if not found.
   */
  getOrThrow(moduleId: string): ModuleHandler {
    const handler = this.modules.get(moduleId);
    if (!handler) {
      throw new Error(`Module not found: ${moduleId}. Available: ${this.listIds().join(", ")}`);
    }
    return handler;
  }

  /**
   * Check if a module is registered.
   */
  has(moduleId: string): boolean {
    return this.modules.has(moduleId);
  }

  /**
   * List all registered module IDs.
   */
  listIds(): string[] {
    return Array.from(this.modules.keys());
  }

  /**
   * List all module metadata.
   */
  listMeta(): ModuleMeta[] {
    return Array.from(this.modules.values()).map((h) => h.meta);
  }

  /**
   * List modules by category.
   */
  listByCategory(category: ModuleCategory): ModuleMeta[] {
    return this.listMeta().filter((m) => m.category === category);
  }

  /**
   * Run all module init() hooks in parallel. Call this after registering
   * all modules and before starting the engine.
   */
  async initAll(): Promise<void> {
    const inits = Array.from(this.modules.values())
      .filter((h) => h.init)
      .map((h) => h.init!());
    await Promise.all(inits);
  }

  /**
   * Dispose all modules (cleanup resources).
   */
  async disposeAll(): Promise<void> {
    const disposals = Array.from(this.modules.values())
      .filter((h) => h.dispose)
      .map((h) => h.dispose!());
    await Promise.allSettled(disposals);
  }
}
