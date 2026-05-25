/**
 * io-browser module — Web page interaction via fetch + real HTML parser.
 *
 * Uses linkedom for HTML parsing (handles real-world malformed HTML correctly,
 * supports CSS selectors via querySelectorAll). Applies SecurityConfig.network
 * for SSRF protection.
 *
 * Modes:
 * - fetch: raw HTML
 * - readable: extract main text content (strips scripts/styles/nav/header/footer)
 * - selector: return content matching a CSS selector
 *
 * Note: This is a fetch-based module. JavaScript-rendered pages won't be
 * fully rendered. For that, install Playwright and use the io-terminal module
 * to invoke playwright scripts.
 */

import { parseHTML } from "linkedom";
import { validateUrl } from "../../security.js";
import type { ModuleHandler, ExecutionContext } from "../../types.js";

// Linkedom returns DOM-like objects but we don't include the DOM lib type.
// Use minimal structural types instead.
type LinkedomDocument = ReturnType<typeof parseHTML>["document"];
type LinkedomElement = {
  textContent: string | null;
  remove: () => void;
};

export const browserModule: ModuleHandler = {
  meta: {
    id: "io-browser",
    name: "浏览器",
    category: "io",
    description: "访问网页并提取内容（基于 linkedom 真实 HTML 解析；不渲染 JavaScript）",
    icon: "globe",
    inputs: [
      { id: "url", name: "网址", type: "string" },
    ],
    outputs: [
      { id: "content", name: "页面内容", type: "string" },
      { id: "title", name: "页面标题", type: "string" },
      { id: "status", name: "状态码", type: "number" },
    ],
    configSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "要访问的网址（输入端口优先）",
        },
        mode: {
          type: "string",
          enum: ["fetch", "readable", "selector"],
          default: "readable",
          description: "模式：fetch=原始HTML, readable=提取正文, selector=按 CSS 选择器提取",
        },
        selector: {
          type: "string",
          description: "CSS 选择器（selector 模式必填，支持任意标准 CSS 选择器）",
        },
        headers: {
          type: "object",
          description: "自定义请求头（JSON）",
        },
        timeout: {
          type: "number",
          default: 30000,
          minimum: 1000,
          maximum: 120000,
          description: "超时时间（毫秒）",
        },
        maxResponseSize: {
          type: "number",
          default: 10485760, // 10MB
          minimum: 1024,
          maximum: 104857600, // 100MB
          description: "最大响应大小（字节，超出则截断）",
        },
      },
      required: [],
    },
  },

  async execute(
    inputs: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<Record<string, unknown>> {
    const url = (inputs.url as string) ?? (config.url as string);
    const mode = (config.mode as string) ?? "readable";
    const selector = config.selector as string | undefined;
    const timeout = (config.timeout as number) ?? 30000;
    const maxResponseSize = (config.maxResponseSize as number) ?? 10 * 1024 * 1024;
    const headers = (config.headers as Record<string, string>) ?? {};

    if (!url) {
      throw new Error("URL is required");
    }

    if (mode === "selector" && !selector) {
      throw new Error("selector mode requires a CSS selector");
    }

    // Security: SSRF protection
    const networkPolicy = context.security?.network;
    if (networkPolicy) {
      await validateUrl(url, networkPolicy);
    }

    // Fetch the page
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; OpenClawWorkflow/0.1; +https://github.com/openclaw)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...headers,
      },
      signal: AbortSignal.timeout(timeout),
      redirect: "follow",
    });

    const status = response.status;

    // Read body with size cap
    const html = await readBoundedText(response, maxResponseSize);

    // Parse with a real HTML parser
    const { document } = parseHTML(html);

    const titleElement = document.querySelector("title");
    const title = titleElement?.textContent?.trim() ?? "";

    let content: string;

    if (mode === "fetch") {
      content = html;
    } else if (mode === "selector") {
      content = extractBySelector(document, selector!);
    } else {
      content = extractReadableContent(document);
    }

    return { content, title, status };
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    received += value.byteLength;
    chunks.push(value);

    if (received >= maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      break;
    }
  }

  // Concatenate
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const merged = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    const remaining = merged.length - offset;
    if (remaining <= 0) break;
    const slice = chunk.byteLength <= remaining ? chunk : chunk.subarray(0, remaining);
    merged.set(slice, offset);
    offset += slice.byteLength;
  }

  // Try to detect charset from Content-Type, fallback to utf-8
  const contentType = response.headers.get("content-type") ?? "";
  const charsetMatch = contentType.match(/charset=([^;]+)/i);
  const charset = charsetMatch?.[1]?.trim().toLowerCase() ?? "utf-8";

  try {
    return new TextDecoder(charset).decode(merged);
  } catch {
    return new TextDecoder("utf-8").decode(merged);
  }
}

/**
 * Extract readable text content using a real DOM.
 * Removes navigation/scripts/styles/aside, then collapses whitespace.
 */
function extractReadableContent(document: LinkedomDocument): string {
  // Strip noise — clone before mutation isn't necessary since linkedom doc is single-use
  const noiseSelectors = [
    "script",
    "style",
    "nav",
    "header",
    "footer",
    "aside",
    "noscript",
    "iframe",
    "[aria-hidden='true']",
  ];
  for (const sel of noiseSelectors) {
    const elements = document.querySelectorAll(sel);
    elements.forEach((el: LinkedomElement) => el.remove());
  }

  // Prefer <main> or <article> if present
  const main =
    document.querySelector("main") ??
    document.querySelector("article") ??
    document.querySelector("body") ??
    document.documentElement;

  if (!main) return "";

  // textContent + whitespace normalization
  const raw = main.textContent ?? "";
  return normalizeWhitespace(raw);
}

/**
 * Extract content by CSS selector. Returns concatenated text from all matches,
 * separated by blank lines. Trims and skips empty results.
 */
function extractBySelector(document: LinkedomDocument, selector: string): string {
  let elements: ArrayLike<LinkedomElement> & { forEach: (cb: (el: LinkedomElement) => void) => void };
  try {
    elements = document.querySelectorAll(selector) as unknown as typeof elements;
  } catch (err) {
    throw new Error(
      `Invalid CSS selector "${selector}": ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const parts: string[] = [];
  elements.forEach((el: LinkedomElement) => {
    const text = normalizeWhitespace(el.textContent ?? "");
    if (text) parts.push(text);
  });

  return parts.join("\n\n");
}

function normalizeWhitespace(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}
