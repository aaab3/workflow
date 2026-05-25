/**
 * io-file-read module - Read local file contents with security restrictions.
 */

import { z } from "zod";
import { readFile, stat } from "node:fs/promises";
import { validateFilePath } from "../../security.js";
import type { ModuleHandler, ExecutionContext } from "../../types.js";

const ENCODINGS = ["utf-8", "ascii", "base64", "binary"] as const;

const configZod = z.object({
  path: z.string().min(1).describe("文件路径（相对于工作目录）"),
  encoding: z.enum(ENCODINGS).default("utf-8").describe("文件编码"),
});

export const fileReadModule: ModuleHandler = {
  meta: {
    id: "io-file-read",
    name: "读取文件",
    category: "io",
    description: "读取本地文件内容（受安全策略限制）",
    icon: "file-input",
    inputs: [],
    outputs: [
      { id: "content", name: "文件内容", type: "string" },
      { id: "size", name: "文件大小(bytes)", type: "number" },
    ],
    configSchema: {}, // Auto-derived
    version: "2.0.0",
  },

  configZod,

  async execute(
    _inputs: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<Record<string, unknown>> {
    const { path: filePath, encoding } = configZod.parse(config);

    // Security: validate path against policy
    const fsPolicy = context.security?.filesystem;
    let resolvedPath = filePath;

    if (fsPolicy) {
      resolvedPath = validateFilePath(filePath, fsPolicy);

      // Check file size before reading
      const fileStat = await stat(resolvedPath);
      if (fileStat.size > fsPolicy.maxFileSize) {
        throw new Error(
          `File size (${fileStat.size} bytes) exceeds limit (${fsPolicy.maxFileSize} bytes)`
        );
      }
    }

    const content = await readFile(resolvedPath, { encoding: encoding as BufferEncoding });
    const size = Buffer.byteLength(content, encoding as BufferEncoding);

    return { content, size };
  },
};
