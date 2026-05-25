/**
 * Agent Runner — Executes a single agent (LLM call with context).
 * This is the atomic unit of the crew framework.
 */

import type { AgentDef, CrewMessage } from "./types.js";

export interface AgentRunInput {
  task: string;
  data?: Record<string, unknown>;
  history?: CrewMessage[];
  blackboard?: Record<string, unknown>;
}

export interface AgentRunOutput {
  content: string;
  data?: Record<string, unknown>;
  tokenUsage: number;
}

/**
 * Run a single agent — send a prompt to the configured LLM and get a response.
 */
export async function runAgent(
  agent: AgentDef,
  input: AgentRunInput
): Promise<AgentRunOutput> {
  const { model } = agent;
  const baseUrl = model.baseUrl ?? "https://api.openai.com/v1";
  const apiKey = model.apiKey ?? process.env.OPENAI_API_KEY ?? "";

  // Build messages
  const messages: Array<{ role: string; content: string }> = [];

  // System prompt
  messages.push({
    role: "system",
    content: buildSystemPrompt(agent, input),
  });

  // History (if context allows)
  if (agent.context.includeHistory !== false && input.history) {
    for (const msg of input.history.slice(-20)) { // Last 20 messages max
      if (msg.from === agent.id) {
        messages.push({ role: "assistant", content: msg.content });
      } else {
        messages.push({ role: "user", content: `[${msg.from}]: ${msg.content}` });
      }
    }
  }

  // Current task/input
  let userContent = input.task;
  if (input.data && Object.keys(input.data).length > 0) {
    userContent += `\n\n输入数据:\n${JSON.stringify(input.data, null, 2)}`;
  }
  if (input.blackboard && Object.keys(input.blackboard).length > 0 && agent.context.mode === "shared") {
    userContent += `\n\n共享状态 (Blackboard):\n${JSON.stringify(input.blackboard, null, 2)}`;
  }
  messages.push({ role: "user", content: userContent });

  // Call LLM
  const response = await callLLM(baseUrl, apiKey, model.name, messages, {
    temperature: model.temperature ?? 0.7,
    maxTokens: model.maxTokens ?? 2048,
  });

  // Try to extract structured data from response
  const parsed = tryParseJSON(response.content);

  return {
    content: response.content,
    data: parsed ?? undefined,
    tokenUsage: response.totalTokens,
  };
}

function buildSystemPrompt(agent: AgentDef, _input: AgentRunInput): string {
  let prompt = agent.systemPrompt;

  // Add role context
  prompt += `\n\n你的角色: ${agent.role}`;

  // Add output format hint if agent has defined outputs
  if (agent.outputs && agent.outputs.length > 0) {
    prompt += `\n\n请在回复末尾附上 JSON 格式的结构化输出，包含以下字段: ${agent.outputs.join(", ")}`;
    prompt += `\n格式: \`\`\`json\n{ ... }\n\`\`\``;
  }

  return prompt;
}

interface LLMResponse {
  content: string;
  totalTokens: number;
}

async function callLLM(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  options: { temperature: number; maxTokens: number }
): Promise<LLMResponse> {
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  const body = {
    model,
    messages,
    temperature: options.temperature,
    max_tokens: options.maxTokens,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000),  // 5 min for reasoning models
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`LLM API error ${response.status}: ${errorText.slice(0, 300)}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string; reasoning_content?: string } }>;
    usage?: { total_tokens: number };
  };

  // Support reasoning models (like o1, mimo) where content may be empty
  // but reasoning_content has the actual response
  const msg = data.choices[0]?.message;
  let content = msg?.content || "";

  // If content is empty but reasoning_content exists (reasoning model),
  // extract the final conclusion from the reasoning chain
  if (!content && msg?.reasoning_content) {
    content = extractConclusionFromReasoning(msg.reasoning_content);
  }

  const totalTokens = data.usage?.total_tokens ?? 0;

  return { content, totalTokens };
}

/**
 * Extract the final conclusion from a reasoning model's thinking chain.
 * Reasoning models output their thought process, but the actual answer
 * is typically in the last paragraph or after markers like "所以", "因此", "最终".
 */
function extractConclusionFromReasoning(reasoning: string): string {
  // Strategy 1: Look for explicit conclusion markers
  const conclusionMarkers = [
    /(?:所以|因此|综上|最终|总结|结论|答案是|我的回答是|最终答案)[：:]\s*([\s\S]{5,})/,
    /(?:So|Therefore|In conclusion|Final answer)[：:]\s*([\s\S]{5,})/i,
  ];

  for (const marker of conclusionMarkers) {
    const match = reasoning.match(marker);
    if (match) {
      return match[1]!.trim().slice(0, 2000);
    }
  }

  // Strategy 2: Take the last meaningful paragraph (after the last double newline)
  const paragraphs = reasoning.split(/\n\n+/).filter((p) => p.trim().length > 10);
  if (paragraphs.length > 1) {
    // Skip paragraphs that start with thinking markers
    const thinkingPrefixes = ["嗯", "让我", "首先", "Hmm", "Let me", "OK", "好的"];
    const lastParagraphs = paragraphs.slice(-3);
    for (let i = lastParagraphs.length - 1; i >= 0; i--) {
      const p = lastParagraphs[i]!.trim();
      const isThinking = thinkingPrefixes.some((prefix) => p.startsWith(prefix));
      if (!isThinking && p.length > 15) {
        return p.slice(0, 2000);
      }
    }
    // Fallback: just use the last paragraph
    return paragraphs[paragraphs.length - 1]!.trim().slice(0, 2000);
  }

  // Strategy 3: If it's short enough, just return it all (it might be the answer itself)
  if (reasoning.length < 500) {
    return reasoning.trim();
  }

  // Strategy 4: Take the last 500 chars as the conclusion
  return reasoning.slice(-500).trim();
}

function tryParseJSON(text: string): Record<string, unknown> | null {
  // Try to find JSON block in markdown code fence
  const jsonMatch = text.match(/```json\s*\n([\s\S]*?)\n```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]!) as Record<string, unknown>;
    } catch {
      // fall through
    }
  }

  // Try to find raw JSON object at the end
  const lastBrace = text.lastIndexOf("}");
  if (lastBrace > 0) {
    const firstBrace = text.lastIndexOf("{", lastBrace);
    if (firstBrace >= 0) {
      try {
        return JSON.parse(text.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
      } catch {
        // fall through
      }
    }
  }

  return null;
}
