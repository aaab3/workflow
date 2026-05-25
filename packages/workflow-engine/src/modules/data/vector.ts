/**
 * data-vector module — Text embedding and similarity search (RAG support).
 *
 * Generates embeddings via OpenAI-compatible API, stores in memory,
 * and performs cosine similarity search.
 */

import type { ModuleHandler, ExecutionContext } from "../../types.js";

// In-memory vector store
interface VectorEntry {
  id: string;
  text: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

const vectorStore = new Map<string, VectorEntry[]>(); // namespace → entries

export const dataVectorModule: ModuleHandler = {
  meta: {
    id: "data-vector",
    name: "向量搜索",
    category: "data",
    description: "文本向量化 + 相似度搜索（RAG 检索增强生成）",
    icon: "search",
    inputs: [
      { id: "text", name: "文本", type: "string" },
      { id: "query", name: "查询", type: "string" },
    ],
    outputs: [
      { id: "results", name: "搜索结果", type: "array" },
      { id: "embedding", name: "向量", type: "array" },
    ],
    configSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["embed", "store", "search", "store_and_search"],
          default: "search",
          description: "操作：embed=生成向量, store=存入库, search=搜索, store_and_search=存入并搜索",
        },
        namespace: {
          type: "string",
          default: "default",
          description: "向量库命名空间（隔离不同数据集）",
        },
        baseUrl: {
          type: "string",
          default: "https://api.openai.com/v1",
          description: "Embedding API 地址",
        },
        apiKey: {
          type: "string",
          description: "API Key",
        },
        model: {
          type: "string",
          default: "text-embedding-3-small",
          description: "Embedding 模型",
        },
        topK: {
          type: "number",
          default: 5,
          minimum: 1,
          maximum: 50,
          description: "返回最相似的 K 条结果",
        },
        threshold: {
          type: "number",
          default: 0.7,
          minimum: 0,
          maximum: 1,
          description: "相似度阈值（低于此值不返回）",
        },
      },
      required: ["operation"],
    },
  },

  async execute(
    inputs: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext
  ): Promise<Record<string, unknown>> {
    const operation = config.operation as string;
    const namespace = (config.namespace as string) ?? "default";
    const topK = (config.topK as number) ?? 5;
    const threshold = (config.threshold as number) ?? 0.7;

    switch (operation) {
      case "embed": {
        const text = inputs.text as string;
        if (!text) throw new Error("embed 操作需要 text 输入");
        const embedding = await getEmbedding(text, config);
        return { embedding, results: [] };
      }

      case "store": {
        const text = inputs.text as string;
        if (!text) throw new Error("store 操作需要 text 输入");
        const embedding = await getEmbedding(text, config);
        const entry: VectorEntry = {
          id: `vec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          text,
          embedding,
        };
        if (!vectorStore.has(namespace)) vectorStore.set(namespace, []);
        vectorStore.get(namespace)!.push(entry);
        return { embedding, results: [{ id: entry.id, text, score: 1.0 }] };
      }

      case "search": {
        const query = (inputs.query as string) ?? (inputs.text as string);
        if (!query) throw new Error("search 操作需要 query 输入");
        const queryEmbedding = await getEmbedding(query, config);
        const results = searchSimilar(namespace, queryEmbedding, topK, threshold);
        return { results, embedding: queryEmbedding };
      }

      case "store_and_search": {
        const text = inputs.text as string;
        const query = inputs.query as string;
        if (text) {
          const embedding = await getEmbedding(text, config);
          const entry: VectorEntry = { id: `vec-${Date.now()}`, text, embedding };
          if (!vectorStore.has(namespace)) vectorStore.set(namespace, []);
          vectorStore.get(namespace)!.push(entry);
        }
        if (query) {
          const queryEmbedding = await getEmbedding(query, config);
          const results = searchSimilar(namespace, queryEmbedding, topK, threshold);
          return { results, embedding: queryEmbedding };
        }
        return { results: [], embedding: [] };
      }

      default:
        throw new Error(`未知操作: ${operation}`);
    }
  },

  async dispose(): Promise<void> {
    vectorStore.clear();
  },
};

async function getEmbedding(text: string, config: Record<string, unknown>): Promise<number[]> {
  const baseUrl = (config.baseUrl as string) ?? "https://api.openai.com/v1";
  const apiKey = (config.apiKey as string) ?? process.env.OPENAI_API_KEY ?? "";
  const model = (config.model as string) ?? "text-embedding-3-small";

  const url = `${baseUrl.replace(/\/$/, "")}/embeddings`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ input: text, model }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`Embedding API error ${response.status}`);
  }

  const data = await response.json() as { data: Array<{ embedding: number[] }> };
  return data.data[0]?.embedding ?? [];
}

function searchSimilar(namespace: string, queryEmbedding: number[], topK: number, threshold: number) {
  const entries = vectorStore.get(namespace) ?? [];
  if (entries.length === 0) return [];

  const scored = entries.map((entry) => ({
    id: entry.id,
    text: entry.text,
    score: cosineSimilarity(queryEmbedding, entry.embedding),
  }));

  return scored
    .filter((s) => s.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}
