/**
 * io-http-request module - Make HTTP/HTTPS requests with SSRF protection.
 */

import { z } from "zod";
import { validateUrl } from "../../security.js";
import type { ModuleHandler, ExecutionContext } from "../../types.js";

const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"] as const;
const RESPONSE_TYPES = ["json", "text", "arraybuffer"] as const;

const configZod = z.object({
  url: z.string().url("Invalid URL").describe("请求 URL"),
  method: z.enum(HTTP_METHODS).default("GET").describe("HTTP 方法"),
  headers: z.record(z.string()).optional().describe("请求头"),
  body: z.unknown().optional().describe("请求体（优先使用输入端口）"),
  timeout: z.number().int().min(100).max(600000).default(30000)
    .describe("请求超时（毫秒）"),
  responseType: z.enum(RESPONSE_TYPES).default("json").describe("响应解析方式"),
});

const inputsZod = z.object({
  body: z.unknown().optional(),
});

type Config = z.infer<typeof configZod>;
type Inputs = z.infer<typeof inputsZod>;

export const httpRequestModule: ModuleHandler = {
  meta: {
    id: "io-http-request",
    name: "HTTP 请求",
    category: "io",
    description: "发送 HTTP/HTTPS 请求（GET/POST/PUT/DELETE，受 SSRF 防护）",
    icon: "globe",
    inputs: [{ id: "body", name: "请求体", type: "any" }],
    outputs: [
      { id: "data", name: "响应数据", type: "any" },
      { id: "status", name: "状态码", type: "number" },
      { id: "headers", name: "响应头", type: "object" },
    ],
    configSchema: {}, // Auto-derived
    version: "2.0.0",
  },

  configZod,
  inputsZod,

  async execute(
    inputs: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<Record<string, unknown>> {
    const cfg = configZod.parse(config);
    const ins = inputsZod.parse(inputs);

    const body = ins.body ?? cfg.body;
    const headers = cfg.headers ?? {};

    // Security: SSRF protection
    const networkPolicy = context.security?.network;
    if (networkPolicy) {
      await validateUrl(cfg.url, networkPolicy);
    }

    // Build fetch options
    const fetchOptions: RequestInit = {
      method: cfg.method,
      headers: { ...headers },
      signal: AbortSignal.timeout(cfg.timeout),
    };

    if (body !== undefined && cfg.method !== "GET" && cfg.method !== "HEAD") {
      if (typeof body === "object" && body !== null) {
        fetchOptions.body = JSON.stringify(body);
        const h = fetchOptions.headers as Record<string, string>;
        h["Content-Type"] = h["Content-Type"] ?? "application/json";
      } else {
        fetchOptions.body = String(body);
      }
    }

    const response = await fetch(cfg.url, fetchOptions);

    let data: unknown;
    switch (cfg.responseType) {
      case "json":
        try {
          data = await response.json();
        } catch {
          data = await response.text();
        }
        break;
      case "text":
        data = await response.text();
        break;
      case "arraybuffer":
        data = `[ArrayBuffer: ${(await response.arrayBuffer()).byteLength} bytes]`;
        break;
    }

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    if (!response.ok) {
      const dataPreview = typeof data === "string"
        ? data.slice(0, 200)
        : JSON.stringify(data).slice(0, 200);
      throw new Error(`HTTP ${response.status}: ${response.statusText} - ${dataPreview}`);
    }

    return {
      data,
      status: response.status,
      headers: responseHeaders,
    };
  },
};
