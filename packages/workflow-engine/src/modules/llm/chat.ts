/**
 * llm-chat module - Chat completion via any OpenAI-compatible API.
 *
 * Supports any provider: OpenAI, Anthropic (via proxy), Ollama, LM Studio,
 * Azure OpenAI, Groq, Together AI, DeepSeek, SiliconFlow, or any
 * OpenAI-compatible endpoint.
 */

import { z } from "zod";
import type { ModuleHandler, ExecutionContext } from "../../types.js";

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

const configZod = z.object({
  baseUrl: z.string().url().default("https://api.openai.com/v1")
    .describe("API 地址（OpenAI/Ollama/LM Studio/任何兼容端点）"),
  apiKey: z.string().default("").describe("API Key（从凭据库选择；亦可填字面值或环境变量名）"),
  model: z.string().min(1).default("gpt-4o-mini").describe("模型名称"),
  messages: z.array(messageSchema).optional().describe("消息列表（优先于输入端口）"),
  systemPrompt: z.string().optional().describe("系统提示词"),
  temperature: z.number().min(0).max(2).default(0.7).describe("温度参数"),
  maxTokens: z.number().int().min(1).max(128000).optional().describe("最大生成 token 数"),
  topP: z.number().min(0).max(1).optional().describe("Top-P 采样"),
});

const inputsZod = z.object({
  userMessage: z.string().optional(),
});

type Config = z.infer<typeof configZod>;
type Inputs = z.infer<typeof inputsZod>;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export const llmChatModule: ModuleHandler = {
  meta: {
    id: "llm-chat",
    name: "LLM 对话",
    category: "llm",
    description: "调用 LLM 进行对话补全（支持任何 OpenAI 兼容 API）",
    icon: "message-square",
    inputs: [{ id: "userMessage", name: "用户消息", type: "string" }],
    outputs: [
      { id: "response", name: "回复内容", type: "string" },
      { id: "usage", name: "Token 用量", type: "object" },
      { id: "finishReason", name: "结束原因", type: "string" },
    ],
    configSchema: {}, // Auto-derived
    version: "2.0.0",
  },

  configZod,
  inputsZod,

  async execute(
    inputs: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext
  ): Promise<Record<string, unknown>> {
    const cfg = config as Config;
    const ins = inputs as Inputs;

    // Resolve API key — try literal, then env var fallback
    const apiKey = cfg.apiKey || process.env.OPENAI_API_KEY || "";

    // Build messages
    let messages: ChatMessage[] = [];

    if (cfg.messages && cfg.messages.length > 0) {
      messages = cfg.messages;
    } else {
      if (cfg.systemPrompt) {
        messages.push({ role: "system", content: cfg.systemPrompt });
      }
      const userMessage = ins.userMessage ?? "";
      if (userMessage) {
        messages.push({ role: "user", content: userMessage });
      }
    }

    if (messages.length === 0) {
      throw new Error("No messages provided. Set config.messages or connect userMessage input.");
    }

    // Build request body
    const body: Record<string, unknown> = {
      model: cfg.model,
      messages,
      temperature: cfg.temperature,
    };
    if (cfg.maxTokens !== undefined) body.max_tokens = cfg.maxTokens;
    if (cfg.topP !== undefined) body.top_p = cfg.topP;

    // Make API call
    const url = `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`LLM API error ${response.status}: ${errorText.slice(0, 500)}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;

    const choice = data.choices[0];
    if (!choice) {
      throw new Error("No completion choice returned from LLM API");
    }

    return {
      response: choice.message.content,
      usage: data.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      finishReason: choice.finish_reason,
    };
  },
};
