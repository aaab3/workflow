/**
 * llm-structured module — Force LLM to output structured JSON matching a schema.
 *
 * Uses OpenAI's response_format: { type: "json_schema" } or falls back to
 * prompt-based JSON extraction for non-OpenAI models.
 */

import type { ModuleHandler, ExecutionContext } from "../../types.js";

export const llmStructuredModule: ModuleHandler = {
  meta: {
    id: "llm-structured",
    name: "LLM 结构化输出",
    category: "llm",
    description: "强制 LLM 输出符合指定 JSON Schema 的结构化数据",
    icon: "braces",
    inputs: [
      { id: "prompt", name: "提示词", type: "string" },
      { id: "data", name: "输入数据", type: "any" },
    ],
    outputs: [
      { id: "result", name: "结构化结果", type: "object" },
      { id: "raw", name: "原始回复", type: "string" },
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
          examples: ["gpt-4o", "gpt-4o-mini", "claude-3-5-sonnet-20241022", "deepseek-chat"],
          default: "gpt-4o-mini",
          description: "模型 ID（推荐 gpt-4o-mini 性价比高；任何支持 JSON 模式的兼容 API 模型都可用）",
        },
        schema: {
          type: "string",
          format: "code",
          description: "输出的 JSON Schema 定义（描述你期望的输出结构）",
        },
        systemPrompt: {
          type: "string",
          description: "系统提示词",
        },
        temperature: {
          type: "number",
          default: 0,
          minimum: 0,
          maximum: 2,
          description: "温度（结构化输出建议用 0）",
        },
      },
      required: ["model", "schema"],
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
    const temperature = (config.temperature as number) ?? 0;
    const systemPrompt = (config.systemPrompt as string) ?? "Extract structured data from the input.";

    // Parse schema
    let schema: Record<string, unknown>;
    try {
      schema = typeof config.schema === "string" ? JSON.parse(config.schema) : (config.schema as Record<string, unknown>);
    } catch {
      throw new Error("schema 格式错误，需要有效的 JSON Schema");
    }

    // Build user message
    let userContent = (inputs.prompt as string) ?? "";
    if (inputs.data) {
      userContent += userContent ? "\n\n" : "";
      userContent += `数据:\n${JSON.stringify(inputs.data, null, 2)}`;
    }

    if (!userContent) {
      throw new Error("需要 prompt 或 data 输入");
    }

    // Build request
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ];

    const body: Record<string, unknown> = {
      model,
      messages,
      temperature,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "output",
          strict: true,
          schema,
        },
      },
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
      // Fallback: try without response_format (for non-OpenAI models)
      const fallbackBody = {
        model,
        messages: [
          { role: "system", content: `${systemPrompt}\n\nYou MUST respond with valid JSON matching this schema:\n${JSON.stringify(schema, null, 2)}\n\nRespond ONLY with the JSON object, no other text.` },
          { role: "user", content: userContent },
        ],
        temperature,
      };

      const fallbackResponse = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify(fallbackBody),
        signal: AbortSignal.timeout(60000),
      });

      if (!fallbackResponse.ok) {
        const errorText = await fallbackResponse.text().catch(() => "");
        throw new Error(`LLM API error: ${errorText.slice(0, 300)}`);
      }

      const fallbackData = await fallbackResponse.json() as { choices: Array<{ message: { content: string } }> };
      const raw = fallbackData.choices[0]?.message?.content ?? "";
      const parsed = extractJSON(raw);
      return { result: parsed, raw };
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    const raw = data.choices[0]?.message?.content ?? "";

    let result: unknown;
    try {
      result = JSON.parse(raw);
    } catch {
      result = extractJSON(raw);
    }

    return { result, raw };
  },
};

function extractJSON(text: string): unknown {
  // Try direct parse
  try { return JSON.parse(text); } catch { /* continue */ }

  // Try finding JSON in code block
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (match) {
    try { return JSON.parse(match[1]!); } catch { /* continue */ }
  }

  // Try finding first { to last }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { /* continue */ }
  }

  return { _raw: text, _error: "Failed to parse JSON" };
}
