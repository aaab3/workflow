/**
 * Module config schemas for the property panel.
 * These define what form controls to show for each module type.
 */

export interface ModuleSchema {
  configSchema: Record<string, unknown>;
}

const MODULE_SCHEMAS: Record<string, ModuleSchema> = {
  "llm-chat": {
    configSchema: {
      type: "object",
      properties: {
        baseUrl: {
          type: "string",
          examples: [
            "https://api.openai.com/v1",
            "http://localhost:11434/v1",
            "http://localhost:1234/v1",
            "https://api.groq.com/openai/v1",
            "https://api.together.xyz/v1",
            "https://api.deepseek.com/v1",
            "https://api.siliconflow.cn/v1",
          ],
          default: "https://api.openai.com/v1",
          description: "API 地址（可手动输入任何 OpenAI 兼容 endpoint）",
        },
        apiKey: {
          type: "string",
          format: "credential",
          credentialType: "openai-api-key",
          credentialField: "apiKey",
          description: "API Key（从凭据库选择，加密存储；也可填环境变量名 OPENAI_API_KEY）",
        },
        model: {
          type: "string",
          examples: [
            "gpt-4o",
            "gpt-4o-mini",
            "o1",
            "o1-mini",
            "claude-3-5-sonnet-20241022",
            "claude-3-5-haiku-20241022",
            "deepseek-chat",
            "deepseek-reasoner",
            "qwen2.5",
            "llama3.3",
            "mistral",
          ],
          default: "gpt-4o-mini",
          description: "模型 ID（可手动输入任何后端支持的模型）",
        },
        systemPrompt: {
          type: "string",
          description: "系统提示词（告诉 AI 它的角色）",
        },
        temperature: {
          type: "number",
          default: 0.7,
          minimum: 0,
          maximum: 2,
          description: "温度参数（0=确定性，2=最随机）",
        },
        maxTokens: {
          type: "number",
          default: 2048,
          minimum: 1,
          maximum: 128000,
          description: "最大生成 token 数",
        },
      },
      required: ["baseUrl", "model"],
    },
  },

  "io-file-read": {
    configSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "文件路径（支持 {{表达式}}）",
        },
        encoding: {
          type: "string",
          enum: ["utf-8", "ascii", "base64", "binary"],
          default: "utf-8",
          description: "文件编码",
        },
      },
      required: ["path"],
    },
  },

  "io-file-write": {
    configSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "输出文件路径",
        },
        content: {
          type: "string",
          description: "写入内容（也可通过输入端口传入）",
        },
        encoding: {
          type: "string",
          enum: ["utf-8", "ascii", "base64"],
          default: "utf-8",
          description: "文件编码",
        },
        append: {
          type: "boolean",
          default: false,
          description: "追加模式（否则覆盖）",
        },
        createDirs: {
          type: "boolean",
          default: true,
          description: "自动创建父目录",
        },
      },
      required: ["path"],
    },
  },

  "io-http-request": {
    configSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "请求 URL",
        },
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"],
          default: "GET",
          description: "HTTP 方法",
        },
        headers: {
          type: "object",
          description: "请求头（JSON 格式）",
        },
        timeout: {
          type: "number",
          default: 30000,
          minimum: 1000,
          maximum: 300000,
          description: "超时时间（毫秒）",
        },
        responseType: {
          type: "string",
          enum: ["json", "text", "arraybuffer"],
          default: "json",
          description: "响应解析方式",
        },
      },
      required: ["url"],
    },
  },

  "io-terminal": {
    configSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "终端命令（如 claude -p、python agent.py、aider --message）",
        },
        stdinMode: {
          type: "string",
          enum: ["none", "text", "json"],
          default: "text",
          description: "输入模式：none=不传入，text=纯文本，json=JSON格式",
        },
        outputMode: {
          type: "string",
          enum: ["text", "json", "lastLine"],
          default: "text",
          description: "输出解析：text=原样，json=解析JSON，lastLine=只取最后一行",
        },
        timeout: {
          type: "number",
          default: 120000,
          minimum: 1000,
          maximum: 3600000,
          description: "超时时间（毫秒），默认 2 分钟",
        },
        cwd: {
          type: "string",
          description: "工作目录（可选）",
        },
        shell: {
          type: "boolean",
          default: true,
          description: "通过 shell 执行（支持管道和通配符）",
        },
      },
      required: ["command"],
    },
  },

  "code-javascript": {
    configSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          format: "code",
          description: "JavaScript 代码（可用 inputs 对象访问输入数据，用 return 返回结果）",
        },
        timeout: {
          type: "number",
          default: 30000,
          minimum: 1000,
          maximum: 120000,
          description: "执行超时（毫秒）",
        },
      },
      required: ["code"],
    },
  },

  "flow-condition": {
    configSchema: {
      type: "object",
      properties: {
        operator: {
          type: "string",
          enum: ["==", "!=", ">", "<", ">=", "<=", "contains", "startsWith", "endsWith", "empty", "notEmpty", "truthy", "falsy"],
          default: "truthy",
          description: "比较运算符",
        },
        compareValue: {
          type: "string",
          description: "比较目标值",
        },
      },
    },
  },

  "flow-delay": {
    configSchema: {
      type: "object",
      properties: {
        duration: {
          type: "number",
          default: 1000,
          minimum: 0,
          maximum: 3600000,
          description: "等待时间（毫秒）",
        },
      },
      required: ["duration"],
    },
  },

  "crew": {
    configSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["auto", "solo", "pipeline", "parallel", "reflect", "moa", "debate", "hierarchy"],
          default: "auto",
          description: "协作模式：auto=AI判断, solo=单Agent, pipeline=流水线, parallel=并行, reflect=反思, moa=投票, debate=辩论, hierarchy=层级",
        },
        agents: {
          type: "array",
          description: "Agent 列表 JSON，每个包含 role/model/systemPrompt",
        },
        contextStrategy: {
          type: "string",
          enum: ["shared", "isolated", "selective"],
          default: "shared",
          description: "上下文策略：shared=全共享, isolated=各自独立, selective=选择性共享",
        },
        maxRounds: {
          type: "number",
          default: 3,
          minimum: 1,
          maximum: 10,
          description: "最大轮次（辩论/反思模式）",
        },
        qualityThreshold: {
          type: "number",
          default: 7,
          minimum: 1,
          maximum: 10,
          description: "质量阈值（反思模式，低于此分数会重试）",
        },
        maxTokens: {
          type: "number",
          default: 100000,
          minimum: 1000,
          maximum: 1000000,
          description: "总 Token 预算上限",
        },
      },
      required: ["mode", "agents"],
    },
  },
};

export function getModuleSchema(moduleType: string): ModuleSchema | null {
  return MODULE_SCHEMAS[moduleType] ?? null;
}
