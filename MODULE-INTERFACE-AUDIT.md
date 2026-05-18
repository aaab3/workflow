# 模块封装与接口审计报告

> 审计范围：所有 19 个内置模块 + ModuleHandler 核心接口
> 调研对象：n8n、Flowise、LangChain、MCP（Model Context Protocol）、JSON Schema 7
> 审计时间：2026-05

---

## 一、ModuleHandler 核心接口的问题

### 当前接口

```typescript
export interface ModuleHandler {
  meta: ModuleMeta;
  execute(
    inputs: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<Record<string, unknown>>;
  validate?(config: Record<string, unknown>): ValidationResult;
  dispose?(): Promise<void>;
}
```

### 问题清单

#### 1. 🔴 输入/输出/配置全是 `Record<string, unknown>` — 类型系统形同虚设

每个模块在 `execute()` 里第一件事都是 `as string`、`as number`、`as Record<string, string>`。`configSchema` 的 JSON Schema 是声明式描述，但运行时**不强制校验**，模块自己用 `??` 兜底默认值。

**业界做法对比：**
- **LangChain** 用 Zod schema：`new DynamicStructuredTool({ schema: z.object({...}), func })`，参数自动校验、自动推断 TS 类型
- **MCP 协议**官方推荐用 Zod 描述 input schema，校验在协议层兜底
- **n8n** 的 `INodeProperties` 强制声明每个参数的 `type/displayName/required/displayOptions`

**改进方向：**
- 模块声明 Zod schema 而不是裸 `Record`
- engine 在调用 `execute()` 前用 schema 自动 parse/校验
- 输出也声明 schema，自动验证返回值符合 `outputs` 端口定义

#### 2. 🟡 没有真正的"取消"语义 — AbortSignal 不传给模块

`engine.ts` 接受 `signal?: AbortSignal`，但 `ModuleHandler.execute()` 的签名里没有 `signal`。模块自己用 `AbortSignal.timeout()` 或 `setTimeout` 模拟，不响应工作流级取消。

`io-terminal` 跑 30 秒，工作流被取消，子进程不会被 kill。`flow-delay` 等 1 小时，取消后还在等。

**改进方向：**
- `execute(inputs, config, context: { signal: AbortSignal, ... })`
- HTTP/fetch 模块直接传 signal
- 子进程模块监听 signal 触发 kill
- 长循环模块定期 check signal

#### 3. 🟡 没有进度上报 — 长任务变黑盒

`execute()` 只能返回最终结果。LLM 流式输出、HTTP 大文件下载、循环遍历 100 个项目 — 用户从开始到结束什么都看不到。

**业界做法：**
- **n8n** 的 `executeFunctions.helpers.streamData()` 让节点流式吐数据
- **LangChain** 用 `streamWriter` 在工具执行中推送中间状态
- **Vercel AI SDK** 工具有 `experimental_streamData()`

**改进方向：**
- `context` 加 `emitProgress(percent, message)` 和 `emitChunk(data)` 方法
- engine 把这些事件转成 `node:progress` / `node:chunk` 事件，server 转 WebSocket/SSE 推给前端

#### 4. 🟡 凭据（API Key、密码）是配置的一部分，明文存 JSON

工作流 JSON 里直接写 `apiKey: "sk-..."`，这是设计层面的问题：
- 工作流文件不能 commit 进 git
- 多人协作时凭据泄露
- 凭据轮换要改所有用到的工作流

**业界做法：**
- **n8n** 把凭据从工作流定义里**完全分离**，独立 `Credentials` 对象，加密存储，工作流只引用 ID
- **Flowise** 类似设计
- **MCP** 的 STDIO 模式直接读环境变量，远程模式用 OAuth

**改进方向：**
- 加 `CredentialDef` 类型 + `CredentialStore` 接口
- configSchema 里某字段标注 `format: "credential"` + `credentialType: "openai-api-key"`
- 模块访问凭据通过 `context.credentials.get(refId)`，不通过 config
- 凭据用 N8N_ENCRYPTION_KEY 风格加密落盘

#### 5. 🟡 模块没有版本字段

`ModuleMeta` 只有 `id`，没有 `version`。如果模块的 configSchema 改了，旧 workflow JSON 加载时会用错误配置静默执行。

**业界做法：**
- n8n 用 `version: 1.0` + `defaultVersion`，旧 workflow 自动适配旧实现
- MCP 的 `serverInfo.version` 是协议必填

**改进方向：**
- `ModuleMeta.version: string`
- engine 加载 workflow 时如果模块版本不匹配，用 migrator 升级配置

#### 6. 🟡 没有 `init()` 生命周期

`dispose()` 有，但没有 `init()`。需要建立连接（数据库、浏览器实例、长连接 LLM client）的模块只能在每次 execute 里冷启动。

**改进方向：**
- 加 `init?(registry: ModuleRegistry): Promise<void>`
- registry 在第一次注册时调用 init，进程退出时 dispose

---

## 二、各模块的具体问题

### 🔴 重大问题

#### `io-browser` — HTML 解析用正则，遇到真实网页就崩

```typescript
const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
text = text.replace(/<[^>]+>/g, "");  // ← 这是 HTML 解析的反模式
```

**问题：**
- 正则解析 HTML 是 Stack Overflow 上著名的[反模式](https://stackoverflow.com/a/1732454)
- 脚本里写 `<title>` 字符串、JSDoc 里写 `<p>`、CSS 里 `content: "<"` 全部解析错
- 没有 SSRF 防护（不接 SecurityConfig.network）
- 「screenshot 模式需要 Playwright」但没真接，只是 fallback 到 readable 模式 — 文档承诺和实现不一致
- selector 支持极简（只支持单个 `tag`、`.class`、`#id`），跨层级选择不支持

**改进方向：**
- 用真正的 HTML parser（`linkedom`、`cheerio`、`htmlparser2`）
- 接 SecurityConfig.network（SSRF 防护）
- screenshot 模式如果没装 Playwright，应该明确报错而不是悄悄降级
- 删掉 fake selector 实现，要么集成 cheerio 的真 CSS selector，要么直接不支持

#### `tool-scheduler` — Cron 实现是玩具

```typescript
function calculateNextCron(cron: string, from: Date): Date {
  const parts = cron.trim().split(/\s+/);
  // Simple: just handle fixed minute/hour
  if (minStr !== "*") {
    next.setMinutes(parseInt(minStr!, 10));
  }
  // ...
}
```

**问题：**
- 不支持 `*/5`（每 5 分钟）、`1-5`（范围）、`1,3,5`（列表）
- 不支持 weekday、month
- 不处理时区（虽然 schema 里有 timezone 字段，代码里没用）
- 文档承诺 "Cron 表达式（如 0 9 * * 1-5 表示工作日9点）" — 实现不支持

**改进方向：**
- 用 `cron-parser` 或 `croner`（npm 上的标准库）
- 时区处理用 Intl.DateTimeFormat 或 luxon

#### `data-vector` — 内存存储 + 全量扫描，名字叫"向量库"很误导

```typescript
const vectorStore = new Map<string, VectorEntry[]>(); // 全局 Map
// ...
const scored = entries.map(...);  // O(n) 遍历
```

**问题：**
- 进程重启数据全没
- 多进程部署时各持一份，数据不一致
- 全量线性扫描（没有 HNSW、IVF 等近似算法），1 万条向量就慢了
- 没有删除/更新接口
- 模块 `dispose()` 里 `vectorStore.clear()` 把所有 namespace 一起清掉
- `embed` 操作浪费了一次 store（写到内存又不被复用）

**改进方向：**
- 提供两套：内存（小规模、demo）+ 适配器（接 Chroma/Qdrant/Faiss/SQLite-vec）
- 名字改为 `data-vector-memory` 明确定位
- 加 delete/update/list namespace 接口
- 用 SQLite + sqlite-vec 做持久化（最少依赖）

#### `code-javascript` — 安全文档说 "Worker Thread"，但 inputs/config 通过 `workerData` 是**结构化克隆传递的**

这点其实是对的，但有两个隐患：
1. **不能传函数/类实例**：`workerData` 走 structuredClone，正则、Map、Set 能传，但 Function、Class 不能 — 用户从上游节点拿到的某些数据会丢失
2. **Worker 启动开销大**：每次 execute 都新建 Worker（约 30-100ms），高频小代码反而比直接 vm 慢

**改进方向：**
- Worker pool（复用 N 个 Worker，长任务分配）
- 文档说明 workerData 的传输限制
- 提供"轻量模式"（小代码用 sandboxed eval，大代码用 Worker）

### 🟡 中等问题

#### `io-database` — 已经修过，但还有遗漏

我刚修完，但回头看：
- `truncated` 字段在 schema 里没声明（只在返回值里冒出来）
- `params` 输入端口的类型是 `any`，可能是数组、对象、单个值，文档不清晰
- 时区处理：SQLite 默认 UTC，没说明用户应该用 `datetime()` 还是字符串

#### `io-http-request` — 配置里的 `body` vs 输入端口的 `body` 优先级混乱

```typescript
const body = inputs.body ?? config.body;
```

- `body` 同时是 input port 和 config 字段 — 一旦上游节点连了 body 输入（默认是 undefined），config 的 body 就被覆盖
- 这是 n8n、Flowise 都遇到的"输入优先 vs 配置优先"问题，他们的解法是给字段加 `expression` 模式

#### `io-terminal` — `args` 字段是个伪选项

```typescript
const args = (config.args as string[]) ?? [];
// ...
if (shell) {
  const fullCommand = args.length > 0 ? `${command} ${args.join(" ")}` : command;
  // ← shell 模式下，args 直接拼字符串，等于没 args
}
```

shell 模式下 args 完全失效。非 shell 模式下也没看到测试。

#### `flow-loop` — `forEach` 模式的 `expression` 用 `new Function` 执行

```typescript
const fn = new Function("item", "index", "items", `return (${expression});`);
```

虽然没有 vm 那种逃逸级风险，但仍然是任意代码执行。`data-transform` 的 filter/map/sort 同样问题。这些应该走 SecurityConfig 的代码策略（甚至直接禁用 / 改成纯表达式语言）。

#### `llm-chat` / `llm-structured` / `llm-vision` — API Key 直接读 `process.env.OPENAI_API_KEY`

```typescript
const apiKey = (config.apiKey as string) ?? process.env.OPENAI_API_KEY ?? "";
```

- 三个 LLM 模块都假设环境变量名是 `OPENAI_API_KEY`，但用户接的可能是 DeepSeek（应该是 `DEEPSEEK_API_KEY`）、Groq、SiliconFlow…
- 这是凭据管理缺失的副作用

#### `tool-cache` — 没有最大条目数限制，会无限膨胀

```typescript
const cache = new Map<string, CacheEntry>();
```

只在 `cleanExpired()` 时清过期项。如果工作流频繁产生新内容，cache 一直涨直到 OOM。
n8n、Redis 这些都用 LRU。

#### `crew` 模块 — 已经在前面几轮重构过，比较扎实

只剩一个小问题：`agents` 字段在 schema 里描述是 `array`，但实际是复杂的嵌套对象数组，UI 表单根本生成不出对应控件。CrewEditor 才是真正的编辑器，但用户在 PropertyPanel 里看到的是个空 textarea。

### 🟢 设计还可以的模块

- `io-file-read/write`、`io-http-request`：security 接好了
- `flow-condition`：纯逻辑，简单
- `flow-delay`：足够简单

---

## 三、跨模块的系统性问题

### 1. configSchema 的 JSON Schema 7 是注释，不是契约

每个模块都写了详细的 configSchema（required、enum、minimum、maximum、default），但：
- engine **不读**这些字段做校验
- 前端 SchemaForm 只用了 `type/enum/examples/default`，`required/minimum/maximum` 只在 number input 上意思一下
- `validate?(config)` 接口几乎没有模块实现

**结果：** Schema 的约束是给人看的，运行时全不强制。用户配错了 → 模块在 `execute` 里 `as string` 取出 undefined → 半截执行后崩溃。

**调研对比：**
- **n8n**：每个 INodeProperties 字段在前端都自动校验，提交前阻拦
- **MCP**：tool schema 是协议层校验，无效输入 server 直接 reject
- **LangChain**：Zod schema 用 `parse()` 做强校验

### 2. 错误信息没有结构化

```typescript
throw new Error(`数据库操作失败: ${error.message}`);
```

模块抛 `Error`，engine 把 `.message` 写进 ErrorEntry。但：
- 错误码硬编码（`MODULE_NOT_FOUND`、`EXECUTION_ERROR`），扩展性差
- 没有"错误类型"分类（用户错误 / 第三方 API 错误 / 系统错误 / 安全策略拦截）
- 没有 `cause` 链（Node 16+ Error 支持 `cause`，可以保留原始错误）

**调研对比：**
- n8n 的 `NodeApiError` 区分 `httpCode/description/parsed body`
- MCP 协议的 error 有标准 code（`InvalidParams`、`MethodNotFound`、`InternalError`）

### 3. 没有"操作类别"标签

Crew、Database、Vector、Browser 这些都有 `operation` 配置（query/embed/store、search、screenshot...）。在 schema 里是个 enum，但本质上是把"多个工具压缩成一个节点"。

**业界做法：**
- n8n 把 Resource + Operation 当一等公民（Slack 节点的 message/channel/user 各自是独立 operation）
- MCP 直接拆成多个 tool（`db_query`、`db_insert` 是两个 tool）

**改进方向：**
- 让一个模块文件可以注册多个 ModuleHandler（Database 拆成 `db-query`、`db-execute`），UI 还是统一的"数据库"分组
- 或者在 configSchema 里支持 `discriminator` 模式（不同 operation 显示不同字段，类似 OpenAPI 的 oneOf+discriminator）

### 4. 模块发现/动态加载缺失

当前所有模块在 `shared-registry.ts` 里硬编码注册。第三方扩展、用户自定义模块没法接入。

**业界做法：**
- n8n 通过 `n8n-nodes-*` npm 包自动扫描
- Flowise 用 `customComponentsPath` 动态加载
- MCP 整个就是动态发现的协议

**改进方向：**
- 支持从某个目录扫描 `.module.ts` 文件
- 支持 npm 包（包名以 `openclaw-module-` 开头自动发现）

### 5. Validate 接口几乎没人实现

```typescript
validate?(config: Record<string, unknown>): ValidationResult;
```

可选 → 没人写 → engine 放过所有配置 → 运行时崩。

**改进方向：**
- 改为非可选，但默认实现做 JSON Schema 校验（用 ajv 或 zod-from-json-schema）
- 模块只在需要额外业务校验时 override

### 6. 输出端口和实际返回字段不匹配

```typescript
// httpRequestModule.outputs:
[{ id: "data" }, { id: "status" }, { id: "headers" }]

// 实际返回:
return { data, status, headers };  // OK

// databaseModule.outputs:
[{ id: "rows" }, { id: "rowCount" }, { id: "lastInsertRowId" }]

// 实际返回:
return { rows, rowCount, lastInsertRowId, truncated };  // ← truncated 不在 outputs 声明里
```

下游节点连不到 `truncated` 端口（因为没声明），但它出现在 output 里。这是默认 contract 不强制导致的。

---

## 四、改进优先级

### P0：必须修（影响安全/正确性）

1. **engine 强制校验 configSchema**：用 ajv 在 `execute()` 之前对 config 做严格 parse，invalid 直接报错不进 execute
2. **AbortSignal 传到 execute()**：长任务能取消
3. **凭据系统**：API Key 不再直存配置 JSON
4. **`io-browser` 的正则 HTML 解析换掉**：用 linkedom 或类似
5. **`tool-scheduler` 的 cron 用 `cron-parser`**

### P1：应该修（影响可用性）

6. **`data-vector` 持久化 + 改名定位**
7. **`code-javascript` Worker pool**
8. **`tool-cache` 加 LRU 上限**
9. **错误结构化**：定义 `ModuleError` 类，分 user/api/system/security 四类
10. **模块加 version 字段 + 配置迁移机制**

### P2：建议修（影响开发体验）

11. **ModuleHandler 改用 Zod schema** — 整体范式升级，工作量大
12. **支持动态模块加载**：`npm install openclaw-module-foo` 即可用
13. **进度事件**：`context.emitProgress(percent, msg)`
14. **operation 字段拆分模块**：`io-database` → `db-query` + `db-execute`

---

## 五、对项目方向的建议

你现在的模块系统在思路上接近 **n8n 的 programmatic style + LangChain 的 tool 范式** 的混合。两边都有可取之处：

- **n8n 的强项**：UI 自动生成、凭据管理、版本管理、生态完整
- **LangChain 的强项**：Zod schema 做类型契约、AI agent 直接调用、与 MCP 兼容
- **MCP 的强项**：协议级标准、工具发现、跨语言

如果项目目标是**给人手工编排**：往 n8n 靠（凭据系统、版本管理、可发现性）
如果项目目标是**给 AI agent 调用**：往 LangChain/MCP 靠（Zod schema、错误标准化、tool 拆分）

你的项目现在两条腿都想走（既有可视化编辑器，又有 MCP server 暴露工作流），所以需要的是**核心接口同时支持两种范式** — 比如 ModuleHandler 用 Zod schema 描述，前端从 Zod 派生 JSON Schema 生成表单，engine 用 Zod 校验，MCP server 直接把 Zod schema 转成 tool input schema。

这是后续重构的最大方向。
