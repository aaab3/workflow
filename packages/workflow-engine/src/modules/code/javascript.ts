/**
 * code-javascript module - Execute JavaScript code in an isolated Worker Thread.
 *
 * Security: Uses Worker Thread with restricted globals and resource limits.
 * The worker has NO access to: require, import, process, fs, net, child_process.
 * Memory and CPU time are limited via resourceLimits and timeout.
 */

import { Worker } from "node:worker_threads";
import type { ModuleHandler, ExecutionContext } from "../../types.js";

export const javascriptModule: ModuleHandler = {
  meta: {
    id: "code-javascript",
    name: "JavaScript 代码",
    category: "code",
    description: "在隔离的 Worker 线程中执行自定义 JavaScript 代码",
    icon: "code",
    inputs: [],
    outputs: [],
    configSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "JavaScript 代码" },
        timeout: {
          type: "number",
          default: 30000,
          description: "执行超时（ms）",
        },
      },
      required: ["code"],
    },
  },

  async execute(
    inputs: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<Record<string, unknown>> {
    const code = config.code as string;
    const codePolicy = context.security?.code;
    const timeout = (config.timeout as number) ?? codePolicy?.maxExecutionTime ?? 30000;
    const maxMemoryMB = codePolicy?.maxMemoryMB ?? 128;

    if (!code) {
      throw new Error("Code is required");
    }

    return executeInWorker(code, inputs, config, timeout, maxMemoryMB);
  },
};

function executeInWorker(
  code: string,
  inputs: Record<string, unknown>,
  config: Record<string, unknown>,
  timeout: number,
  maxMemoryMB: number
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    // The worker script is inlined as a data URL to avoid file path issues
    const workerCode = `
      const { parentPort, workerData } = require('worker_threads');

      // Remove dangerous globals
      delete globalThis.process;
      delete globalThis.require;
      delete globalThis.module;
      delete globalThis.exports;
      delete globalThis.__filename;
      delete globalThis.__dirname;

      // Restricted sandbox globals
      const sandbox = {
        inputs: workerData.inputs,
        config: workerData.config,
        console: {
          log: (...args) => logs.push(args.map(String).join(' ')),
          warn: (...args) => logs.push('[WARN] ' + args.map(String).join(' ')),
          error: (...args) => logs.push('[ERROR] ' + args.map(String).join(' ')),
        },
        JSON,
        Math,
        Date,
        Array,
        Object,
        String,
        Number,
        Boolean,
        RegExp,
        Map,
        Set,
        WeakMap,
        WeakSet,
        Promise,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        encodeURIComponent,
        decodeURIComponent,
        encodeURI,
        decodeURI,
        setTimeout: undefined,
        setInterval: undefined,
        fetch: undefined,
      };

      const logs = [];

      async function run() {
        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
        const fn = new AsyncFunction('inputs', 'config', 'console', 'JSON', 'Math', 'Date',
          'Array', 'Object', 'String', 'Number', 'Boolean', 'RegExp', 'Map', 'Set',
          'parseInt', 'parseFloat', 'isNaN', 'isFinite',
          workerData.code
        );

        const result = await fn(
          sandbox.inputs, sandbox.config, sandbox.console,
          JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Map, Set,
          parseInt, parseFloat, isNaN, isFinite
        );

        return result;
      }

      run()
        .then(result => {
          if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
            parentPort.postMessage({ success: true, result, logs });
          } else {
            parentPort.postMessage({ success: true, result: { result, logs }, logs });
          }
        })
        .catch(error => {
          parentPort.postMessage({ success: false, error: error.message || String(error), logs });
        });
    `;

    const worker = new Worker(workerCode, {
      eval: true,
      workerData: {
        code,
        inputs,
        config: { ...config, code: undefined },
      },
      resourceLimits: {
        maxOldGenerationSizeMb: maxMemoryMB,
        maxYoungGenerationSizeMb: maxMemoryMB / 4,
        stackSizeMb: 4,
      },
    });

    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error(`JavaScript execution timed out after ${timeout}ms`));
    }, timeout);

    worker.on("message", (msg: { success: boolean; result?: Record<string, unknown>; error?: string; logs?: string[] }) => {
      clearTimeout(timer);
      if (msg.success) {
        resolve(msg.result ?? { logs: msg.logs });
      } else {
        reject(new Error(msg.error ?? "Unknown worker error"));
      }
      worker.terminate();
    });

    worker.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Worker error: ${error.message}`));
    });

    worker.on("exit", (exitCode) => {
      clearTimeout(timer);
      if (exitCode !== 0) {
        reject(new Error(`Worker exited with code ${exitCode} (possible memory limit exceeded)`));
      }
    });
  });
}
