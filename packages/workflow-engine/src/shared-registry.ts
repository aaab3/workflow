/**
 * Shared default registry — single source of truth for all built-in modules.
 * Eliminates duplication across CLI, server routes, and WebSocket handlers.
 */

import { ModuleRegistry } from "./module-registry.js";
import { fileReadModule, fileWriteModule, httpRequestModule, terminalModule, databaseModule, browserModule } from "./modules/io/index.js";
import { javascriptModule } from "./modules/code/index.js";
import { conditionModule, delayModule, loopModule } from "./modules/flow/index.js";
import { llmChatModule, llmStructuredModule, llmVisionModule } from "./modules/llm/index.js";
import { crewModule } from "./modules/crew/index.js";
import { dataTransformModule, dataVectorModule } from "./modules/data/index.js";
import { toolCacheModule, toolSchedulerModule } from "./modules/tool/index.js";

/**
 * Create a ModuleRegistry pre-loaded with all built-in modules.
 */
export function createDefaultRegistry(): ModuleRegistry {
  const registry = new ModuleRegistry();
  // IO
  registry.register(fileReadModule);
  registry.register(fileWriteModule);
  registry.register(httpRequestModule);
  registry.register(terminalModule);
  registry.register(databaseModule);
  registry.register(browserModule);
  // Code
  registry.register(javascriptModule);
  // Flow
  registry.register(conditionModule);
  registry.register(delayModule);
  registry.register(loopModule);
  // LLM
  registry.register(llmChatModule);
  registry.register(llmStructuredModule);
  registry.register(llmVisionModule);
  registry.register(crewModule);
  // Data
  registry.register(dataTransformModule);
  registry.register(dataVectorModule);
  // Tool
  registry.register(toolCacheModule);
  registry.register(toolSchedulerModule);
  return registry;
}
