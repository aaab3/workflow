/**
 * io-file-write module - Write content to a local file with security restrictions.
 */

import { z } from "zod";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { validateFilePath } from "../../security.js";
import type { ModuleHandler, ExecutionContext } from "../../types.js";

const ENCODINGS = ["utf-8", "ascii", "base64"] as const;

const configZod = z.object({
  path: z.string().min(1).describe("文件路径（相对于工作目录）"),
  content: z.string().optional().describe("写入内容（优先使用输入端口）"),
  encoding: z.enum(ENCODINGS).default("utf-8").describe("文件编码"),
  createDirs: z.boolean().default(true).describe("自动创建父目录"),
  append: z.boolean().default(false).describe("追加模式（否则覆盖）"),
});

const inputsZod = z.object({
  content: z.string().optional(),
});

export const fileWriteModule: ModuleHandler = {
  meta: {
    id: "io-file-write",
    name: "写入文件",
    category: "io",
    description: "将内容写入本地文件（受安全策略限制）",
    icon: "file-output",
    inputs: [{ id: "content", name: "内容", type: "string" }],
    outputs: [
      { id: "success", name: "是否成功", type: "boolean" },
      { id: "path", name: "文件路径", type: "string" },
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

    const filePath = cfg.path;
    const content = ins.content ?? cfg.content ?? "";
    const encoding = cfg.encoding as BufferEncoding;

    // Security: validate path against policy
    const fsPolicy = context.security?.filesystem;
    let resolvedPath = filePath;

    if (fsPolicy) {
      resolvedPath = validateFilePath(filePath, fsPolicy);

      const contentSize = Buffer.byteLength(content, encoding);
      if (contentSize > fsPolicy.maxFileSize) {
        throw new Error(
          `Content size (${contentSize} bytes) exceeds limit (${fsPolicy.maxFileSize} bytes)`
        );
      }
    }

    if (cfg.createDirs) {
      await mkdir(dirname(resolvedPath), { recursive: true });
    }

    await writeFile(resolvedPath, content, { encoding, flag: cfg.append ? "a" : "w" });

    return { success: true, path: resolvedPath };
  },
};
