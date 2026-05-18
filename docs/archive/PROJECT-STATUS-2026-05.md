# OpenClaw Workflow Plugin — 项目现状文档

> 最后更新：2026-05-16
> 用途：交接给其他 AI 或开发者继续开发

---

## 1. 项目概述

这是一个**可视化工作流编排工具**，用户通过拖拽节点、连线来组装自动化工作流。核心卖点是通过 `io-terminal` 模块可以编排任何有 CLI 接口的 AI Agent（Claude、Aider 等）。

**项目位置**：`C:\Users\29480\Desktop\workflow\`

**技术栈**：
- 前端：React 19 + @xyflow/react 12 + Zustand 5 + Tailwind CSS 4 + Vite 6
- 后端：Fastify 5 + TypeScript + WebSocket
- 引擎：自研图执行器（支持并行、条件、重试）
- 包管理：pnpm 11 monorepo

---

## 2. 项目结构

```
workflow/
├── packages/
│   ├── workflow-engine/     # 执行引擎（纯逻辑，无 UI 依赖）
│   ├── workflow-server/     # HTTP/WebSocket API 服务
│   └── workflow-ui/         # React 前端界面
├── workflows/examples/      # 示例工作流 JSON
├── workflow-plugin-design.md # 设计文档 v2.0
├── 使用手册.md              # 416 行详细用户手册
├── start.bat               # Windows 一键启动脚本
├── package.json            # monorepo 根配置
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── vitest.workspace.ts
```

---

## 3. 各包详情

### 3.1 @openclaw/workflow-engine

**职责**：工作流的核心执行逻辑，不依赖 HTTP 或 UI。

**源文件**（`packages/workflow-engine/src/`）：

| 文件 | 职责 |
|------|------|
| `types.ts` | 所有 TypeScript 类型定义（Workflow, Node, Edge, ExecutionContext 等） |
| `graph.ts` | 图构建、拓扑排序、环检测（Kahn 算法） |
| `engine.ts` | 核心执行器：波次并行调度、重试、错误策略 |
| `context.ts` | 执行上下文管理（状态更新、日志、指标） |
| `expression.ts` | `{{}}` 模板表达式解析器（支持 `??` 默认值） |
| `module-registry.ts` | 模块注册中心 |
| `cli.ts` | CLI 入口（run/validate/list 命令） |
| `modules/` | 8 个内置模块实现 |

**已实现的模块**（8 个）：

| 模块 ID | 文件 | 功能 |
|---------|------|------|
| `llm-chat` | `modules/llm/chat.ts` | OpenAI 兼容 API 对话补全 |
| `io-file-read` | `modules/io/file-read.ts` | 读取本地文件 |
| `io-file-write` | `modules/io/file-write.ts` | 写入本地文件 |
| `io-http-request` | `modules/io/http-request.ts` | HTTP 请求（fetch） |
| `io-terminal` | `modules/io/terminal.ts` | 终端命令/Agent 调用（stdin/stdout） |
| `code-javascript` | `modules/code/javascript.ts` | JS 沙箱执行（vm 模块） |
| `flow-condition` | `modules/flow/condition.ts` | 条件分支（12 种运算符） |
| `flow-delay` | `modules/flow/delay.ts` | 延时等待 |

**测试**（`__tests__/`）：4 个文件，30 个测试用例全部通过
- `graph.test.ts` — 图验证、环检测、拓扑排序
- `expression.test.ts` — 表达式解析、默认值、嵌套对象
- `engine.test.ts` — 串行执行、fail-fast、continue、重试、事件
- `parallel.test.ts` — 并行执行、并发限制、依赖保序、菱形模式

**关键设计决策**：
- 执行器是波次并行的：每轮找出所有依赖已满足的节点，并发执行（受 concurrencyLimit 限制）
- 错误策略三种：fail-fast（立即停止）、continue（跳过下游继续）、pause（暂停等待）
- 节点级重试：支持 fixed/exponential 退避
- 表达式系统：`{{nodeId.portId}}`、`{{input.xxx}}`、`{{vars.xxx}}`、`{{env.XXX}}`
- 大对象处理：>1MB 的输出存临时文件（设计了但未实现 outputRef 机制）

### 3.2 @openclaw/workflow-server

**职责**：HTTP REST API + WebSocket 实时事件推送。

**源文件**（`packages/workflow-server/src/`）：

| 文件 | 职责 |
|------|------|
| `server.ts` | Fastify 入口，注册插件和路由 |
| `routes/workflows.ts` | 工作流 CRUD API（9 个端点） |
| `routes/executions.ts` | 执行控制 API（5 个端点）+ 模块查询 |
| `storage/file-storage.ts` | 文件系统存储（JSON 文件） |
| `ws/execution-ws.ts` | WebSocket 实时执行事件推送 |

**API 端点**：

```
GET    /api/health
GET    /api/workflows
POST   /api/workflows
GET    /api/workflows/:id
PUT    /api/workflows/:id
DELETE /api/workflows/:id
POST   /api/workflows/:id/clone
POST   /api/workflows/:id/validate
GET    /api/workflows/:id/export
POST   /api/workflows/import
POST   /api/workflows/:id/execute
GET    /api/executions
GET    /api/executions/:execId
GET    /api/executions/:execId/logs
GET    /api/modules
GET    /api/modules/:id
WS     /ws/execute/:workflowId
```

**端口**：3100

### 3.3 @openclaw/workflow-ui

**职责**：React 前端，可视化工作流编辑器。

**源文件**（`packages/workflow-ui/src/`）：

| 文件/目录 | 职责 |
|-----------|------|
| `App.tsx` | 主布局（Toolbar + ModulePanel + Canvas + PropertyPanel + ExecutionPanel） |
| `main.tsx` | React 入口 |
| `index.css` | Tailwind + React Flow 样式 |
| `api/client.ts` | REST API 客户端封装 |
| `stores/workflow-store.ts` | Zustand 状态管理（节点/边/选择/撤销重做） |
| `stores/history.ts` | Undo/Redo 历史栈（最多 50 步） |
| `stores/module-schemas.ts` | 每个模块的 JSON Schema 配置定义 |
| `components/Canvas.tsx` | React Flow 画布 + 拖拽 + 自定义节点映射 |
| `components/nodes/WorkflowNode.tsx` | 自定义节点组件（分类颜色、端口可视化） |
| `components/ModulePanel.tsx` | 左侧模块面板（分类、搜索、拖拽） |
| `components/PropertyPanel.tsx` | 右侧属性面板（Schema 驱动表单） |
| `components/SchemaForm.tsx` | JSON Schema → 表单控件自动生成 |
| `components/Toolbar.tsx` | 顶部工具栏（保存/运行/撤销/重做/帮助） |
| `components/ExecutionPanel.tsx` | 底部执行结果面板 |
| `components/WorkflowList.tsx` | 工作流列表弹窗 |
| `components/OnboardingGuide.tsx` | 7 步新手引导 |
| `components/HelpCenter.tsx` | 帮助中心（6 个 Tab） |
| `components/help/guide.md` | 416 行详细使用手册（Markdown） |
| `components/help/MarkdownView.tsx` | 简易 Markdown 渲染器 |

**端口**：3200（开发模式，自动代理 /api 到 3100）

---

## 4. 当前状态

### 已完成 ✅

| 功能 | 状态 |
|------|------|
| monorepo 搭建（pnpm workspace） | ✅ |
| 图执行引擎（拓扑排序 + 波次并行） | ✅ |
| 表达式系统 `{{}}` | ✅ |
| 8 个内置模块 | ✅ |
| 错误策略（fail-fast/continue） | ✅ |
| 节点级重试（指数退避） | ✅ |
| CLI（run/validate/list） | ✅ |
| Fastify REST API（14 个端点） | ✅ |
| WebSocket 实时事件 | ✅ |
| 文件系统存储 | ✅ |
| React Flow 可视化画布 | ✅ |
| 自定义节点渲染（分类颜色 + 端口） | ✅ |
| 拖拽添加节点 | ✅ |
| JSON Schema 驱动配置表单 | ✅ |
| 撤销/重做（Ctrl+Z/Y） | ✅ |
| 执行结果面板 | ✅ |
| 工作流列表（加载/新建/删除） | ✅ |
| 新手引导（7 步交互式） | ✅ |
| 帮助中心（6 Tab + 详细手册） | ✅ |
| 桌面快捷方式一键启动 | ✅ |
| 30 个单元测试全部通过 | ✅ |
| TypeScript strict 三包零错误 | ✅ |

### 未完成 ❌

| 功能 | 优先级 | 说明 |
|------|--------|------|
| WebSocket 实时执行状态推送到 UI | P0 | 后端已实现 WS，前端未接入，当前是同步等待 |
| 连线类型校验 | P0 | 拖线时应检查端口类型兼容性 |
| 凭证/密钥管理 | P1 | API Key 不应明文存在工作流 JSON 里 |
| 流式 LLM 输出 | P1 | llm-stream 模块 + UI 实时显示 |
| 循环节点（flow-loop） | P1 | 设计文档已写，代码未实现 |
| isolated-vm 沙箱 | P1 | 当前用 Node.js vm（不安全），需替换 |
| Python 进程池 | P2 | code-python 模块 |
| 数据处理模块（json-path, regex, template 等） | P2 | 设计文档已列出 |
| 工具模块（log, uuid, timestamp 等） | P2 | 设计文档已列出 |
| 节点分组/子工作流 | P2 | |
| 执行历史持久化 | P2 | 当前只在内存中 |
| 触发器系统（cron/webhook/file-watch） | P3 | |
| 调试模式（断点 + 逐步执行） | P3 | |
| 暗色主题 | P3 | |
| 导出为图片 | P3 | |
| 插件系统（第三方模块） | P3 | |

---

## 5. 如何运行

### 前置条件
- Node.js >= 20
- pnpm（已全局安装，版本 11.1.2）

### 启动方式

**方式 1：一键启动**
双击桌面的 "OpenClaw Workflow" 快捷方式（或运行 `start.bat`）

**方式 2：手动启动**
```bash
cd C:\Users\29480\Desktop\workflow

# 安装依赖（首次）
pnpm install

# 构建引擎
pnpm --filter @openclaw/workflow-engine build

# 启动后端（终端 1）
pnpm --filter @openclaw/workflow-server dev

# 启动前端（终端 2）
pnpm --filter @openclaw/workflow-ui dev

# 打开浏览器
# http://localhost:3200
```

**方式 3：CLI 直接执行工作流**
```bash
node packages/workflow-engine/dist/cli.js run workflows/examples/hello-world.json --input.name=Test
```

### 运行测试
```bash
pnpm --filter @openclaw/workflow-engine test:run
```

### 类型检查
```bash
pnpm --filter @openclaw/workflow-engine typecheck
pnpm --filter @openclaw/workflow-server typecheck
pnpm --filter @openclaw/workflow-ui typecheck
```

---

## 6. 关键代码入口

| 你想做什么 | 看哪个文件 |
|-----------|-----------|
| 理解执行流程 | `packages/workflow-engine/src/engine.ts` |
| 添加新模块 | 参考 `packages/workflow-engine/src/modules/io/terminal.ts`，然后在 `modules/index.ts` 导出，在 `cli.ts` 和 server 的 `executions.ts` 注册 |
| 修改 UI 布局 | `packages/workflow-ui/src/App.tsx` |
| 修改节点外观 | `packages/workflow-ui/src/components/nodes/WorkflowNode.tsx` |
| 添加新模块的配置表单 | `packages/workflow-ui/src/stores/module-schemas.ts` |
| 添加新模块到面板 | `packages/workflow-ui/src/components/ModulePanel.tsx`（fallback 列表）+ `Canvas.tsx`（getDefaultInputs/getDefaultOutputs） |
| 修改 API | `packages/workflow-server/src/routes/` |
| 理解数据类型 | `packages/workflow-engine/src/types.ts` |

---

## 7. 添加新模块的步骤

1. 在 `packages/workflow-engine/src/modules/` 对应类别目录下创建文件
2. 实现 `ModuleHandler` 接口（meta + execute）
3. 在 `modules/index.ts` 导出
4. 在 `packages/workflow-engine/src/index.ts` 导出
5. 在 `packages/workflow-engine/src/cli.ts` 的 `createRegistry()` 注册
6. 在 `packages/workflow-server/src/routes/executions.ts` 的 `createRegistry()` 注册
7. 在 `packages/workflow-server/src/ws/execution-ws.ts` 的 `createRegistry()` 注册
8. 在 `packages/workflow-ui/src/stores/module-schemas.ts` 添加配置 Schema
9. 在 `packages/workflow-ui/src/components/ModulePanel.tsx` 的 fallback 列表添加
10. 在 `packages/workflow-ui/src/components/Canvas.tsx` 的 `getDefaultInputs/getDefaultOutputs` 添加

---

## 8. 已知问题

1. **模块注册重复代码**：`createRegistry()` 在 cli.ts、executions.ts、execution-ws.ts 三处重复，应抽取为共享函数
2. **前端未接入 WebSocket**：执行时是同步 HTTP 等待，长时间执行无进度反馈
3. **vm 沙箱不安全**：code-javascript 用的是 Node.js vm 模块，有逃逸风险，需替换为 isolated-vm
4. **无凭证管理**：API Key 明文存在工作流 JSON 中
5. **执行历史仅内存**：服务重启后丢失
6. **Tailwind 部分未生效**：UI 主要用 inline styles，Tailwind utility classes 在部分场景不工作（v4 的 @import 语法兼容问题）
7. **连线无类型校验**：任何端口都能连任何端口，不会阻止不兼容的连接

---

## 9. 代码统计

- TypeScript 源文件：35 个
- 总代码行数：约 5820 行
- 测试用例：30 个（全部通过）
- 内置模块：8 个
- API 端点：14 REST + 1 WebSocket
- 构建产物：UI bundle 约 458KB (gzip 145KB)

---

## 10. 设计文档参考

详细的架构设计、技术选型理由、模块清单、API 设计、开发计划等见：
- `workflow-plugin-design.md` — 完整设计文档 v2.0（678 行）
- `使用手册.md` — 用户使用手册（416 行）
