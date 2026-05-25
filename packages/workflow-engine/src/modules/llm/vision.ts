/**
 * llm-vision module — Send images to multimodal LLMs for analysis.
 *
 * Supports GPT-4o, Claude 3, and any OpenAI-compatible vision API.
 * Input: image URL or base64 + text prompt
 * Output: LLM's description/analysis of the image
 */

import type { ModuleHandler, ExecutionContext } from "../../types.js";

export const llmVisionModule: ModuleHandler = {
  meta: {
    id: "llm-vision",
    name: "LLM 视觉",
    category: "llm",
    description: "让 AI 分析图片内容（支持 URL 或 base64）",
    icon: "eye",
    inputs: [
      { id: "image", name: "图片", type: "string" },
      { id: "prompt", name: "提示词", type: "string" },
    ],
    outputs: [
      { id: "description", name: "分析结果", type: "string" },
      { id: "usage", name: "Token 用量", type: "object" },
    ],
    configSchema: {
      type: "object",
      properties: {
        baseUrl: {
          type: "string",
          default: "https://api.openai.com/v1",
          description: "API 地址",
        },
        apiKey: {
          type: "string",
          format: "credential",
          credentialType: "openai-api-key",
          credentialField: "apiKey",
          description: "API Key（从凭据库选择）",
        },
        model: {
          type: "string",
          examples: [
            "gpt-4o",
            "gpt-4o-mini",
            "claude-3-5-sonnet-20241022",
            "qwen2-vl",
            "llama3.2-vision",
          ],
          default: "gpt-4o-mini",
          description: "视觉模型 ID（可手动输入任何支持视觉的模型）",
        },
        prompt: {
          type: "string",
          default: "描述这张图片的内容",
          description: "默认提示词（输入端口优先）",
        },
        imageSource: {
          type: "string",
          enum: ["url", "base64", "file"],
          default: "url",
          description: "图片来源类型",
        },
        maxTokens: {
          type: "number",
          default: 1024,
          description: "最大输出 token",
        },
      },
      required: ["model"],
    },
  },

  async execute(
    inputs: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext
  ): Promise<Record<string, unknown>> {
    const baseUrl = (config.baseUrl as string) ?? "https://api.openai.com/v1";
    const apiKey = (config.apiKey as string) ?? process.env.OPENAI_API_KEY ?? "";
    const model = (config.model as string) ?? "gpt-4o-mini";
    const maxTokens = (config.maxTokens as number) ?? 1024;
    const imageSource = (config.imageSource as string) ?? "url";

    const prompt = (inputs.prompt as string) ?? (config.prompt as string) ?? "描述这张图片的内容";
    const image = inputs.image as string;

    if (!image) {
      throw new Error("需要提供图片（URL 或 base64）");
    }

    // Build image content based on source type
    let imageContent: { type: string; image_url: { url: string } };

    if (imageSource === "base64" || image.startsWith("data:")) {
      const dataUrl = image.startsWith("data:") ? image : `data:image/png;base64,${image}`;
      imageContent = { type: "image_url", image_url: { url: dataUrl } };
    } else if (imageSource === "file") {
      // Read file and convert to base64
      const { readFileSync } = await import("node:fs");
      const buffer = readFileSync(image);
      const base64 = buffer.toString("base64");
      const ext = image.split(".").pop()?.toLowerCase() ?? "png";
      const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
      imageContent = { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } };
    } else {
      imageContent = { type: "image_url", image_url: { url: image } };
    }

    const body = {
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            imageContent,
          ],
        },
      ],
      max_tokens: maxTokens,
    };

    const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Vision API error ${response.status}: ${errorText.slice(0, 300)}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
      usage?: { total_tokens: number; prompt_tokens: number; completion_tokens: number };
    };

    return {
      description: data.choices[0]?.message?.content ?? "",
      usage: data.usage ?? { total_tokens: 0 },
    };
  },
};
