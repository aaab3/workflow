# OpenClaw Workflow Plugin — 开发设计文档 v2.0

> 本文档基于 2026 年 5 月最新技术生态调研结果优化，修正了原版中的安全隐患、过时依赖和架构设计缺陷。

## 1. 项目概述

### 1.1 定位

OpenClaw Workflow 是 OpenClaw 的可视化工作流编排插件。用户通过拖拽内置模块 + 自定义代码，组装出自动化工作流，由 OpenClaw 引擎统一执行。

### 1.2 核心特性

- **可视化编辑器**：拖拽式节点连线，零代码拼接工作流
- **丰富内置模块**：LLM调用、HTTP请求、文件IO、数据转换、流程控制等 30+ 模块
- **自定义代码节点**：支持 JavaScript 和 Python 代码块嵌入工作流
- **双模式运行**：Web UI 手动触发 + CLI/API 自动化触发
- **工作流即配置**：工作流保存为 JSON，可版本控制、导入导出、分享

### 1.3 架构总览

```
+-----------------------------------------------------+
|                  Web UI (React + React Flow)          |
|  +-----------+  +----------+  +-----------------+   |
|  | 模块面板   |  | 画布编辑  |  | 属性/调试面板   |   |
|  +-----------+  +----------+  +-----------------+   |
+------------------------+----------------------------+
                         | REST API / WebSocket
+------------------------+----------------------------+
|              Workflow Server (Node.js / Fastify)      |
|  +----------+  +----------+  +-----------------+    |
|  | API 层    |  | 执行引擎  |  | 模块注册中心    |    |
|  +----------+  +----------+  +-----------------+    |
+------------------------+----------------------------+
                         |
+------------------------+----------------------------+
|              OpenClaw Core (现有代理层)               |
|  HTTP Proxy / Model Proxy / Provider Config          |
+-----------------------------------------------------+
```

### 1.4 非目标（Scope 边界）

以下内容不在当前版本范围内，但预留扩展点：

- 多租户隔离与权限系统（当前为本地单用户工具）
- 分布式执行集群
- 工作流市场/社区分享平台
- 可视化表单构建器

---

## 2. 技术栈选型

| 层级 | 技术 | 版本 | 理由 |
|------|------|------|------|
| 前端框架 | React + TypeScript | ^19.x | React 19 稳定版，Actions 简化异步状态，编译器优化减少重渲染 |
| 可视化引擎 | @xyflow/react | ^12.x | React Flow v12 重构包名和 API，性能更优，TS 支持完善 |
| UI 组件库 | Radix UI + Tailwind CSS | Tailwind ^4.x | v4 CSS-first 配置，Lightning CSS 编译，构建速度提升 5x |
| 代码编辑器 | @monaco-editor/react | ^4.x | VS Code 同款，语法高亮+智能提示 |
| 状态管理 | Zustand | ^5.x | 轻量无 boilerplate，middleware 生态丰富，适合画布复杂状态 |
| 后端框架 | Fastify + TypeScript | ^5.x | 内置 JSON Schema 验证，插件系统成熟，吞吐量是 Express 的 2-3x |
| 执行引擎 | 自研 Graph Runner | - | 支持并行/条件/受控循环的图执行器 |
| JS 沙箱 | Worker Thread (当前) / isolated-vm (规划) | - | 当前实现：Worker Thread + AsyncFunction + resourceLimits（线程级隔离，非 V8 Isolate）。规划升级 isolated-vm 实现强隔离。 |
| Python 执行 | 常驻进程池 + JSON-RPC | - | 避免 spawn 启动开销，支持超时和资源限制 |
| 数据存储 | 文件系统 (JSON) | - | 零依赖，工作流即文件，方便 git 管理 |
| 实时通信 | WebSocket (ws) | ^8.x | 执行状态实时推送到 UI |
| 构建工具 | Vite | ^6.x | Rolldown (Rust) bundler，构建性能大幅提升 |
| 包管理 | pnpm workspace | ^9.x | monorepo 管理，严格依赖提升 |

### 2.1 关键选型变更说明

#### 为什么从 Express 换到 Fastify？

- 内置 JSON Schema 请求/响应验证（模块配置校验天然适配）
- 插件封装机制更清晰（每个模块类别可以是独立插件）
- 基准测试中吞吐量是 Express 的 2-3 倍
- TypeScript 类型推导更完整，路由参数自动推断

#### 为什么不用 vm2？

vm2 于 2023 年 7 月因无法修复的沙箱逃逸漏洞被废弃（CVE-2023-37466），npm 页面标注 "contains critical security issues"。2026 年又曝出 CVE-2026-22709。

**替代方案对比：**

| 方案 | 隔离级别 | 性能 | 适用场景 |
|------|---------|------|---------|
| **Worker Thread (当前实现)** | 线程级 + V8 resourceLimits | 高 | 当前默认。删除全局对象、禁用 require/process，但**不是 V8 Isolate 级强隔离**，不要执行不可信代码 |
| isolated-vm (规划) | V8 Isolate（进程内独立堆） | 高 | 高性能 + 强隔离，规划替换为该方案 |
| quickjs-emscripten | WASM 沙箱（独立引擎） | 中 | 最强隔离、零信任 |
| Node.js vm | 无真正隔离 | 最高 | **不可用于不可信代码** |

**当前安全承诺**：Worker Thread + `resourceLimits.maxOldGenerationSizeMb` 提供线程级隔离和内存上限，并通过删除全局对象（`process`、`require`、`module` 等）减少攻击面。这对工作流场景（用户编写自己的 JS 节点）是合理的，但**不是抗攻击的强隔离**，不应该执行外部不可信代码。规划替换为 isolated-vm 以实现 V8 Isolate 级隔离。

#### 为什么升级到 React 19？

React 19 于 2024.12 稳定发布（当前 19.2.x）：
- Actions 简化表单提交和异步状态管理
- `use()` hook 简化数据获取
- 编译器优化减少不必要的重渲染
- 更好的错误边界和 Suspense 支持

---

## 3. 核心概念模型

### 3.1 工作流 (Workflow)

```typescript
interface Workflow {
  id: string;                    // UUID v7（时间有序）
  name: string;                  // 显示名称
  description?: string;          // 描述
  version: string;               // 语义化版本号
  nodes: WorkflowNode[];         // 节点列表
  edges: WorkflowEdge[];         // 连线列表
  variables: VariableDef[];      // 全局变量定义（带类型）
  triggers: Trigger[];           // 触发方式
  settings: WorkflowSettings;   // 工作流级别配置
  createdAt: string;             // ISO 8601
  updatedAt: string;             // ISO 8601
}

interface WorkflowSettings {
  maxExecutionTime: number;      // 最大执行时间（ms），默认 300_000
  maxNodeRetries: number;        // 默认重试次数，默认 0
  errorStrategy: "fail-fast" | "continue" | "pause";
  concurrencyLimit: number;      // 并行节点最大并发数，默认 10
}

interface VariableDef {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  defaultValue?: unknown;
  description?: string;
}
```

### 3.2 节点 (Node)

```typescript
interface WorkflowNode {
  id: string;                    // 节点唯一ID
  type: string;                  // 模块类型标识
  position: { x: number; y: number };
  data: {
    label: string;               // 显示标签
    config: Record<string, unknown>; // 模块配置参数
    inputs: PortDef[];           // 输入端口定义
    outputs: PortDef[];          // 输出端口定义
  };
  settings?: NodeSettings;       // 节点级别配置
}

interface NodeSettings {
  timeout?: number;              // 节点超时（ms）
  retries?: number;              // 重试次数
  retryDelay?: number;           // 重试基础间隔（ms）
  retryBackoff?: "fixed" | "exponential";
  continueOnError?: boolean;     // 失败时是否继续下游
  notes?: string;                // 开发者备注
}

interface PortDef {
  id: string;
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array" | "any";
  required?: boolean;
  description?: string;
}
```

### 3.3 连线 (Edge)

```typescript
interface WorkflowEdge {
  id: string;
  source: string;        // 源节点ID
  sourceHandle: string;  // 源输出端口
  target: string;        // 目标节点ID
  targetHandle: string;  // 目标输入端口
  condition?: string;    // 条件表达式（用于条件分支）
}
```

### 3.4 触发器 (Trigger)

```typescript
interface Trigger {
  type: "manual" | "cron" | "webhook" | "file-watch" | "event";
  enabled: boolean;
  config: Record<string, unknown>;
}
```

---

## 4. 内置模块清单

### 4.1 LLM 模块

| 模块 | 功能 | 输入 | 输出 |
|------|------|------|------|
| `llm-chat` | 对话补全 | messages, model, temperature, maxTokens | response, usage |
| `llm-completion` | 文本补全 | prompt, model, maxTokens | text, usage |
| `llm-embedding` | 文本向量化 | text, model | vector, dimensions |
| `llm-batch` | 批量调用 | items[], template, model | results[] |
| `llm-stream` | 流式输出 | messages, model | stream chunks |
| `llm-router` | 模型路由 | input, rules[] | 路由到指定模型 |

### 4.2 数据处理模块

| 模块 | 功能 |
|------|------|
| `data-json-parse` | JSON 解析/序列化 |
| `data-json-path` | JSONPath 提取 |
| `data-template` | 模板字符串渲染（Handlebars 语法） |
| `data-regex` | 正则匹配/替换/提取 |
| `data-transform` | 字段映射/重命名/过滤 |
| `data-split` | 文本分割（按行/按分隔符/按长度） |
| `data-merge` | 多输入合并为一个对象/数组 |
| `data-csv` | CSV 解析/生成 |
| `data-base64` | Base64 编解码 |
| `data-hash` | MD5/SHA256 哈希 |

### 4.3 IO 模块

| 模块 | 功能 |
|------|------|
| `io-http-request` | HTTP/HTTPS 请求（GET/POST/PUT/DELETE） |
| `io-file-read` | 读取本地文件 |
| `io-file-write` | 写入本地文件 |
| `io-file-list` | 列出目录文件 |
| `io-shell` | 执行 shell 命令 |
| `io-websocket` | WebSocket 客户端 |
| `io-clipboard` | 读写剪贴板 |

### 4.4 流程控制模块

| 模块 | 功能 |
|------|------|
| `flow-condition` | 条件分支（if/else） |
| `flow-switch` | 多路分支（switch/case） |
| `flow-loop` | 循环（for-each / while），执行内部子图 |
| `flow-parallel` | 并行执行多个分支 |
| `flow-delay` | 延时等待 |
| `flow-retry` | 失败重试（指数退避） |
| `flow-error-handler` | 错误捕获和处理（try/catch 语义） |
| `flow-sub-workflow` | 调用另一个工作流（最大嵌套深度 10） |

### 4.5 自定义代码模块

| 模块 | 功能 |
|------|------|
| `code-javascript` | 内嵌 JS 代码执行（Worker Thread + resourceLimits，规划升级 isolated-vm） |
| `code-python` | 内嵌 Python 代码执行（进程池） |
| `code-expression` | 简单表达式求值（安全子集） |

### 4.6 工具模块

| 模块 | 功能 |
|------|------|
| `tool-log` | 日志输出 |
| `tool-notify` | 通知（控制台/webhook） |
| `tool-variable-set` | 设置全局变量 |
| `tool-variable-get` | 读取全局变量 |
| `tool-timestamp` | 获取当前时间戳 |
| `tool-uuid` | 生成 UUID |
| `tool-assert` | 断言检查 |

---

## 5. 执行引擎设计

### 5.1 图执行模型

> **重要设计决策**：本引擎不是严格的 DAG 执行器，而是支持"受控循环"的图执行器。循环节点（`flow-loop`）将其内部连接的节点视为一个子图，在每次迭代中重新执行该子图，而非在顶层图中引入回边。

**执行流程：**

```
1. 加载工作流 JSON
2. 验证图结构：
   a. 检测顶层图是否存在非法环（排除 flow-loop 内部子图）
   b. 验证端口类型兼容性
   c. 检测 flow-sub-workflow 递归调用（最大深度 10）
3. 拓扑排序确定执行顺序
4. 从入口节点开始，按依赖关系逐步执行
5. 每个节点执行：
   a. 收集输入（从上游节点输出 + 全局变量 + 表达式求值）
   b. 调用模块 handler
   c. 存储输出到上下文（大对象走临时文件引用）
   d. 通过 WebSocket 推送状态
6. 遇到 flow-parallel → Promise.allSettled 并发（受 concurrencyLimit 限制）
7. 遇到 flow-condition/flow-switch → 评估条件选择分支
8. 遇到 flow-loop → 迭代执行子图（带 maxIterations 安全阀）
9. 全部完成 → 返回最终输出 + 执行摘要
```

### 5.2 执行上下文

```typescript
interface ExecutionContext {
  workflowId: string;
  executionId: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | "paused";
  startTime: number;
  endTime?: number;
  nodeStates: Map<string, NodeExecutionState>;
  variables: Record<string, unknown>;     // 运行时变量
  logs: LogEntry[];
  errors: ErrorEntry[];
  metrics: ExecutionMetrics;
}

interface NodeExecutionState {
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  output?: unknown;                       // 小对象直接存储
  outputRef?: string;                     // 大对象（>1MB）存临时文件路径
  startTime?: number;
  endTime?: number;
  retryCount: number;
  error?: ErrorEntry;
}

interface ExecutionMetrics {
  totalNodes: number;
  completedNodes: number;
  failedNodes: number;
  skippedNodes: number;
  totalDuration?: number;
}

interface LogEntry {
  timestamp: number;
  nodeId?: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  data?: unknown;
}

interface ErrorEntry {
  timestamp: number;
  nodeId: string;
  code: string;
  message: string;
  stack?: string;
  retryable: boolean;
}
```

### 5.3 错误处理策略

引擎支持三种错误策略，在 `WorkflowSettings.errorStrategy` 中配置：

| 策略 | 行为 |
|------|------|
| `fail-fast` | 任一节点失败立即终止整个工作流 |
| `continue` | 失败节点标记为 failed，跳过其下游依赖节点，其他分支继续 |
| `pause` | 失败时暂停执行，等待用户决定（重试/跳过/终止） |

**节点级重试机制：**

```typescript
// 重试配置示例
{
  retries: 3,
  retryDelay: 1000,        // 基础延迟 1s
  retryBackoff: "exponential"  // 实际延迟: 1s, 2s, 4s
}
```

**flow-error-handler 节点语义：**

- 作用范围：捕获其所有上游节点（通过 error 端口连接）的异常
- 类似 try/catch：被捕获的错误不会触发工作流级别的 fail-fast
- 输出：`{ error, nodeId, retryCount }` 供下游决策

### 5.4 模块接口规范

```typescript
interface ModuleHandler {
  meta: {
    id: string;
    name: string;
    category: "llm" | "data" | "io" | "flow" | "code" | "tool";
    description: string;
    icon: string;
    inputs: PortDef[];
    outputs: PortDef[];
    configSchema: JSONSchema7;   // JSON Schema 7 规范
  };

  execute(
    inputs: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<Record<string, unknown>>;

  validate?(config: Record<string, unknown>): ValidationResult;

  /** 可选：清理资源（如关闭连接） */
  dispose?(): Promise<void>;
}

interface ValidationResult {
  valid: boolean;
  errors?: Array<{ path: string; message: string }>;
}
```

### 5.5 表达式系统

模板变量使用 `{{expression}}` 语法，支持以下作用域：

| 前缀 | 含义 | 示例 |
|------|------|------|
| `节点ID.端口ID` | 引用上游节点输出 | `{{node-1.content}}` |
| `input.字段名` | 工作流输入参数 | `{{input.filePath}}` |
| `vars.变量名` | 全局变量 | `{{vars.apiKey}}` |
| `env.变量名` | 环境变量（只读） | `{{env.NODE_ENV}}` |

**求值规则：**
- 表达式在节点执行前求值（lazy evaluation）
- 空值处理：未定义的引用返回 `undefined`，可用 `??` 提供默认值
- 类型转换：自动按目标端口类型转换，失败时报错
- 安全性：表达式求值使用受限的 AST 解析器，不允许函数调用或副作用

### 5.6 自定义代码执行

**JavaScript 节点（Worker Thread + resourceLimits，规划升级 isolated-vm）：**

```javascript
// 用户代码在 V8 Isolate 中执行
// 可用全局对象：inputs, config, console (仅 log/warn/error)
// 不可用：require, fetch, fs, process, setTimeout

const result = inputs.text.toUpperCase();
return { output: result };
```

**执行约束：**
- 内存限制：128MB（可配置）
- 执行超时：30s（可配置）
- 无文件系统、网络、进程访问
- 通过 `context.transfer()` 传递大数据时使用 ArrayBuffer 零拷贝

**Python 节点（常驻进程池）：**

```python
# 通过 JSON-RPC 与常驻 Python 进程通信
# 可用：标准库 + 预装的 numpy/pandas（可配置）
# 不可用：subprocess, socket（生产模式）

import json
result = inputs["text"].upper()
return {"output": result}
```

**进程池设计：**
- 启动时预热 2 个 Python worker 进程
- 最大 worker 数：CPU 核心数（可配置）
- 空闲超时：60s 后回收
- 每次执行通过 stdin/stdout JSON-RPC 通信，避免 spawn 开销
- 支持 per-node 超时配置

---

## 6. API 设计

### 6.1 工作流管理

```
GET    /api/workflows              # 列出所有工作流（支持分页、搜索）
POST   /api/workflows              # 创建工作流
GET    /api/workflows/:id          # 获取工作流详情
PUT    /api/workflows/:id          # 更新工作流
DELETE /api/workflows/:id          # 删除工作流
POST   /api/workflows/:id/clone    # 克隆工作流
POST   /api/workflows/import       # 导入工作流 JSON
GET    /api/workflows/:id/export   # 导出工作流 JSON
POST   /api/workflows/:id/validate # 验证工作流配置
```

### 6.2 执行控制

```
POST   /api/workflows/:id/execute         # 执行工作流
POST   /api/workflows/:id/execute/dry-run # 试运行（不产生副作用）
GET    /api/executions                    # 列出执行历史
GET    /api/executions/:execId            # 获取执行状态
POST   /api/executions/:execId/cancel     # 取消执行
POST   /api/executions/:execId/pause      # 暂停执行
POST   /api/executions/:execId/resume     # 恢复执行
GET    /api/executions/:execId/logs       # 获取执行日志
```

### 6.3 模块注册

```
GET    /api/modules                 # 列出所有可用模块
GET    /api/modules/:id             # 获取模块详情和配置 schema
GET    /api/modules/:id/schema      # 获取模块配置的 JSON Schema
```

### 6.4 WebSocket 事件

```
ws://host:port/ws/execution/:execId

// 服务端 → 客户端事件
事件类型：
- execution:start  { executionId, timestamp }
- node:start       { nodeId, timestamp }
- node:progress    { nodeId, progress, message }  // 用于流式/批量
- node:complete    { nodeId, output, duration }
- node:error       { nodeId, error, retryCount, willRetry }
- node:skip        { nodeId, reason }
- log              { nodeId, level, message, timestamp }
- execution:complete { outputs, duration, metrics }
- execution:error    { message, nodeId?, fatal }
- execution:paused   { nodeId, reason }

// 客户端 → 服务端命令
- cancel           {}
- pause            {}
- resume           { action: "retry" | "skip" | "abort" }
```

---

## 7. 前端 UI 设计

### 7.1 页面布局

```
+----------------------------------------------------------+
|  顶部工具栏：工作流名称 | 保存 | 运行 | 调试 | 导出      |
+--------+---------------------------------+---------------+
|        |                                 |               |
| 左侧   |        中央画布                  |  右侧属性     |
| 模块   |   (React Flow 节点编辑器)        |  面板         |
| 面板   |                                 |               |
|        |                                 |  - 节点配置   |
| 分类   |   拖拽节点 + 连线               |  - 输入映射   |
| 搜索   |                                 |  - 输出预览   |
| 收藏   |                                 |  - 代码编辑   |
|        |                                 |               |
+--------+---------------------------------+---------------+
|  底部面板：执行日志 | 变量监视 | 错误信息 | 性能指标      |
+----------------------------------------------------------+
```

### 7.2 交互设计要点

- **拖拽添加**：从左侧模块面板拖入画布即创建节点
- **连线**：从输出端口拖到输入端口，自动类型兼容性检查（不兼容时显示警告）
- **快捷键**：Delete 删除、Ctrl+C/V 复制粘贴、Ctrl+Z/Y 撤销重做
- **小地图**：右下角缩略图导航
- **节点分组**：框选多个节点可创建分组（折叠/展开）
- **实时预览**：选中节点时右侧显示上次执行的输出数据
- **调试模式**：逐节点执行，可设置断点暂停，查看中间数据
- **连线动画**：执行时数据流向动画，直观展示执行进度
- **错误高亮**：失败节点红色边框 + 错误气泡提示

---

## 8. 目录结构

```
workflow/                          # 项目根目录
├── packages/
│   ├── workflow-engine/          # 执行引擎（纯逻辑，无UI依赖）
│   │   ├── src/
│   │   │   ├── engine.ts         # 图执行器核心
│   │   │   ├── graph.ts          # 图构建、验证、拓扑排序
│   │   │   ├── context.ts        # 执行上下文
│   │   │   ├── expression.ts     # 表达式解析器
│   │   │   ├── module-registry.ts # 模块注册中心
│   │   │   ├── sandbox/
│   │   │   │   ├── js-sandbox.ts  # isolated-vm 封装
│   │   │   │   └── py-pool.ts     # Python 进程池
│   │   │   ├── modules/          # 内置模块实现
│   │   │   │   ├── llm/
│   │   │   │   ├── data/
│   │   │   │   ├── io/
│   │   │   │   ├── flow/
│   │   │   │   ├── code/
│   │   │   │   └── tool/
│   │   │   └── types.ts          # 类型定义
│   │   ├── __tests__/            # 单元测试
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── workflow-server/          # HTTP/WS 服务
│   │   ├── src/
│   │   │   ├── server.ts         # Fastify 入口
│   │   │   ├── plugins/          # Fastify 插件
│   │   │   ├── routes/           # API 路由
│   │   │   ├── ws/               # WebSocket 处理
│   │   │   └── storage/          # 工作流文件存储
│   │   ├── __tests__/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── workflow-ui/              # 前端界面
│       ├── src/
│       │   ├── App.tsx
│       │   ├── components/
│       │   │   ├── Canvas/       # React Flow 画布
│       │   │   ├── ModulePanel/  # 左侧模块面板
│       │   │   ├── PropertyPanel/ # 右侧属性面板
│       │   │   ├── Toolbar/      # 顶部工具栏
│       │   │   ├── LogPanel/     # 底部日志面板
│       │   │   └── CodeEditor/   # Monaco 代码编辑器
│       │   ├── hooks/
│       │   ├── stores/           # Zustand 状态管理
│       │   ├── api/              # API 客户端
│       │   └── types/
│       ├── __tests__/
│       ├── package.json
│       ├── vite.config.ts
│       └── tsconfig.json
│
├── workflows/                    # 用户工作流存储目录
│   └── examples/                 # 示例工作流
│       ├── translate-chain.json
│       ├── batch-summarize.json
│       └── file-processor.json
│
├── package.json                  # 根 monorepo 配置
├── pnpm-workspace.yaml
├── tsconfig.base.json            # 共享 TS 配置
├── .eslintrc.cjs                 # 共享 lint 配置
├── vitest.workspace.ts           # 测试配置
└── README.md
```

---

## 9. 与 OpenClaw 现有系统的集成

### 9.1 LLM 模块调用路径

```
workflow llm-chat 节点
  → 读取 OpenClaw provider 配置
  → 通过 openclaw-http-proxy 发送请求
  → 代理转发到目标模型 API
  → 返回结果到工作流上下文
```

### 9.2 配置复用

工作流引擎读取 OpenClaw 的 provider 配置（`openclaw.json`），LLM 模块自动获取可用模型列表、API Key、baseUrl 等信息，用户无需重复配置。

```typescript
import { loadOpenClawConfig } from "./openclaw-config";

const config = loadOpenClawConfig();
// config.models.providers.openai.baseUrl -> "http://127.0.0.1:18789/v1"
// config.models.providers.openai.models -> [{id: "gpt-4o"}, ...]
```

### 9.3 代理兼容

工作流的 LLM 请求默认走 OpenClaw 的 HTTP 代理（端口 18789），享受模型路由、effort 归一化等现有功能。

---

## 10. CLI 执行模式

```bash
# 执行指定工作流
openclaw-workflow run ./workflows/translate-chain.json

# 带输入参数
openclaw-workflow run ./workflows/batch-summarize.json \
  --input.files="./docs/*.md" \
  --input.targetLang="zh"

# 列出所有工作流
openclaw-workflow list

# 验证工作流配置（检查图结构、端口类型、表达式语法）
openclaw-workflow validate ./workflows/my-flow.json

# 试运行（不产生副作用，仅验证数据流）
openclaw-workflow dry-run ./workflows/my-flow.json

# 以 daemon 模式运行（监听触发器）
openclaw-workflow daemon
```

---

## 11. 示例工作流 JSON

```json
{
  "id": "translate-chain-001",
  "name": "翻译链",
  "description": "读取文件 -> LLM翻译 -> 写入结果",
  "version": "1.0.0",
  "settings": {
    "maxExecutionTime": 60000,
    "maxNodeRetries": 1,
    "errorStrategy": "fail-fast",
    "concurrencyLimit": 5
  },
  "nodes": [
    {
      "id": "node-1",
      "type": "io-file-read",
      "position": { "x": 100, "y": 200 },
      "data": {
        "label": "读取源文件",
        "config": { "path": "{{input.filePath}}" },
        "inputs": [],
        "outputs": [{ "id": "content", "name": "文件内容", "type": "string" }]
      }
    },
    {
      "id": "node-2",
      "type": "llm-chat",
      "position": { "x": 400, "y": 200 },
      "data": {
        "label": "翻译",
        "config": {
          "model": "gpt-4o",
          "messages": [
            { "role": "system", "content": "你是专业翻译，将以下内容翻译为{{input.targetLang}}" },
            { "role": "user", "content": "{{node-1.content}}" }
          ],
          "temperature": 0.3
        },
        "inputs": [{ "id": "content", "name": "原文", "type": "string" }],
        "outputs": [{ "id": "response", "name": "译文", "type": "string" }]
      },
      "settings": {
        "retries": 2,
        "retryDelay": 2000,
        "retryBackoff": "exponential"
      }
    },
    {
      "id": "node-3",
      "type": "io-file-write",
      "position": { "x": 700, "y": 200 },
      "data": {
        "label": "保存译文",
        "config": {
          "path": "{{input.outputPath}}",
          "content": "{{node-2.response}}"
        },
        "inputs": [{ "id": "content", "name": "内容", "type": "string" }],
        "outputs": [{ "id": "success", "name": "是否成功", "type": "boolean" }]
      }
    }
  ],
  "edges": [
    { "id": "e1", "source": "node-1", "sourceHandle": "content", "target": "node-2", "targetHandle": "content" },
    { "id": "e2", "source": "node-2", "sourceHandle": "response", "target": "node-3", "targetHandle": "content" }
  ],
  "variables": [],
  "triggers": [{ "type": "manual", "enabled": true, "config": {} }]
}
```

---

## 12. 开发计划（分阶段）

### Phase 1 — 引擎核心 MVP（3 周）

目标：能跑通三节点串行工作流 + CLI 执行

- [ ] 搭建 monorepo 结构（pnpm workspace + tsconfig + vitest）
- [ ] 实现图构建和验证（拓扑排序 + 环检测）
- [ ] 实现顺序执行器（单线程串行）
- [ ] 实现执行上下文和变量系统
- [ ] 实现表达式解析器（`{{}}` 语法）
- [ ] 实现模块注册中心
- [ ] 实现 3 个核心模块：`io-file-read`、`io-file-write`、`code-javascript`（先用 vm 模块，后续替换）
- [ ] CLI 执行入口（run + validate 命令）
- [ ] 单元测试覆盖核心执行路径

### Phase 2 — 引擎增强（2 周）

目标：支持并行、条件、LLM 调用

- [ ] 并行执行器（Promise.allSettled + concurrencyLimit）
- [ ] 条件/分支节点
- [ ] 循环节点（子图迭代 + maxIterations 安全阀）
- [ ] `llm-chat` 模块 + OpenClaw 配置集成
- [ ] `io-http-request` 模块
- [ ] isolated-vm 沙箱替换 vm 模块
- [ ] 节点级重试机制（指数退避）
- [ ] 错误处理策略（fail-fast / continue / pause）

### Phase 3 — 服务层（2 周）

- [ ] Fastify API 服务搭建
- [ ] 工作流 CRUD API + JSON Schema 验证
- [ ] 执行控制 API（execute / cancel / pause / resume）
- [ ] WebSocket 实时状态推送
- [ ] 文件系统存储层
- [ ] 执行历史持久化

### Phase 4 — 前端 UI（3-4 周）

- [ ] React 19 + Vite 6 项目搭建
- [ ] @xyflow/react 画布集成
- [ ] 模块面板（分类 + 搜索 + 拖拽）
- [ ] 属性配置面板（基于 JSON Schema 动态生成表单）
- [ ] Monaco 代码编辑器集成
- [ ] 执行状态可视化（节点高亮 + 连线动画 + 日志面板）
- [ ] 工作流保存/加载
- [ ] 撤销/重做系统

### Phase 5 — 完善模块 + Python（2 周）

- [ ] Python 常驻进程池实现
- [ ] `code-python` 模块
- [ ] 补全数据处理模块（json-path, template, regex, transform, split, merge）
- [ ] 补全工具模块
- [ ] 大对象临时文件引用机制

### Phase 6 — 高级功能（持续迭代）

- [ ] 触发器系统（cron/webhook/file-watch）
- [ ] 工作流版本管理（基于 git diff）
- [ ] 导入/导出/分享
- [ ] 调试模式（断点 + 逐步执行 + 变量监视）
- [ ] 执行历史和统计面板
- [ ] 流式输出支持（llm-stream 节点 + UI 实时显示）
- [ ] daemon 模式

---

## 13. 关键设计决策

### Q: 为什么用文件系统而不是数据库？

工作流本质是配置文件（JSON），用文件系统存储意味着：
- 可以直接 git 版本控制
- 零外部依赖，部署简单
- 用户可以手动编辑
- 方便导入导出
- 未来如需数据库，存储层接口已抽象，可无缝切换

### Q: 为什么执行引擎独立为包？

`workflow-engine` 不依赖 HTTP 服务或 UI，可以：
- 被 CLI 直接调用
- 被其他 Node.js 项目引用
- 独立测试（纯函数式，易于 mock）
- 未来嵌入其他系统

### Q: 循环节点如何避免无限循环？

- 每个 `flow-loop` 节点必须配置 `maxIterations`（默认 1000）
- 引擎在每次迭代后检查计数器
- 超过限制时抛出 `MaxIterationsExceeded` 错误
- while 循环额外支持 `timeout` 配置

### Q: 如何处理大数据在节点间传递？

- 小对象（<1MB）：直接存储在 `nodeStates.output`
- 大对象（>=1MB）：写入临时文件，`outputRef` 存储路径
- 下游节点通过表达式引用时，引擎自动从文件加载
- 执行完成后，临时文件按策略清理（立即/延迟/保留）

### Q: 自定义代码的安全性？

- 当前实现：JS 代码在 Worker Thread 中执行，使用 `resourceLimits` 限制内存（默认 128MB），删除 `process`/`require`/`module` 等全局对象。**这是线程级隔离，不是 V8 Isolate 级强隔离**，不适合执行外部不可信代码。
- 默认无文件系统、网络、进程访问
- 内存限制 128MB，执行超时 30s
- Python 代码通过进程池执行，可配置超时
- 生产环境可选 Docker 容器隔离执行
- 本地开发环境可通过配置放宽限制

### Q: 如何处理长时间运行的工作流？

- 每个执行有唯一 ID，状态持久化到文件
- 支持取消和暂停操作
- 节点级超时配置
- 失败节点可从断点恢复（pause 策略下）
- WebSocket 断线重连后可恢复状态订阅

---

## 14. 依赖清单

```json
{
  "workflow-engine": {
    "isolated-vm": "^5.0.0",
    "openai": "^5.x",
    "handlebars": "^4.x",
    "jsonpath-plus": "^10.x",
    "cron-parser": "^5.x",
    "uuid": "^11.x",
    "zod": "^3.x"
  },
  "workflow-server": {
    "fastify": "^5.x",
    "@fastify/websocket": "^11.x",
    "@fastify/cors": "^10.x",
    "chokidar": "^4.x"
  },
  "workflow-ui": {
    "@xyflow/react": "^12.x",
    "@monaco-editor/react": "^4.x",
    "@radix-ui/react-dialog": "^1.x",
    "@radix-ui/react-dropdown-menu": "^2.x",
    "@radix-ui/react-tooltip": "^1.x",
    "tailwindcss": "^4.x",
    "zustand": "^5.x",
    "react": "^19.x",
    "react-dom": "^19.x"
  },
  "devDependencies (shared)": {
    "typescript": "^5.7",
    "vite": "^6.x",
    "vitest": "^3.x",
    "eslint": "^9.x",
    "@types/node": "^22.x"
  }
}
```

---

## 15. 测试策略

| 层级 | 工具 | 覆盖目标 |
|------|------|---------|
| 单元测试 | Vitest | 引擎核心逻辑、表达式解析、模块 handler |
| 集成测试 | Vitest + Supertest | API 路由、WebSocket 事件、存储层 |
| E2E 测试 | Playwright | UI 拖拽、执行流程、断点调试 |
| 性能测试 | 自定义 benchmark | 100 节点并行执行、大数据传递 |

**关键测试场景：**
- 图验证：环检测、孤立节点、类型不匹配
- 执行：串行/并行/条件/循环的正确性
- 错误处理：重试、fail-fast、continue、pause
- 沙箱：内存超限、执行超时、逃逸尝试
- 并发：多个工作流同时执行的资源隔离