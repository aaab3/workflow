# OpenClaw Workflow

可视化工作流编排工具，通过拖拽节点、连线来组装自动化工作流。核心卖点是通过 `io-terminal` 模块可以编排任何有 CLI 接口的 AI Agent（Claude、Aider 等）。

## 技术栈

- **前端**：React 19 + @xyflow/react 12 + Zustand 5 + Tailwind CSS 4 + Vite 6
- **后端**：Fastify 5 + TypeScript + WebSocket
- **引擎**：自研图执行器（拓扑排序 + 波次并行调度）
- **包管理**：pnpm 11 monorepo

## 项目结构

```
packages/
├── workflow-engine/   # 执行引擎（纯逻辑，无 UI 依赖）
├── workflow-server/   # HTTP/WebSocket API 服务（端口 3100）
└── workflow-ui/       # React 前端界面（端口 3200）
```

## 官方模板工作流（10 个）

服务启动时会自动将以下模板写入 `workflows/`（已存在则跳过）：

| ID | 名称 | 说明 |
|----|------|------|
| tpl-01-data-pipeline | 数据处理流水线 | JS → 过滤 → 统计 → 报告 |
| tpl-02-condition-router | 条件分支路由 | 分数判断双路径合并 |
| tpl-03-loop-batch | 循环批处理 | forEach 订单金额计算 |
| tpl-04-parallel-merge | 并行任务汇聚 | 三分支延时后汇聚 |
| tpl-05-http-fetch | HTTP API 聚合 | 请求 JSONPlaceholder（需联网） |
| tpl-06-file-etl | 文件读写 ETL | 写入/读取 `workflows/seed-data/` |
| tpl-07-error-continue | 容错继续执行 | continue 策略 + 并行支路 |
| tpl-08-js-chain | 多级 JS 编排 | 5 段链式处理 |
| tpl-09-cache-layer | 缓存加速层 | LRU 缓存双路径 |
| tpl-10-full-automation | 综合自动化流程 | 条件 + 循环 + 延时 + 统计 |

```bash
# 写入 JSON 到 workflows/ 目录
pnpm seed:templates

# 本地执行测试（10/10 应全部 completed）
pnpm test:templates
```

在 UI 中打开 **工作流** 列表，带「模板」徽章的即为官方模板。

## 当前进度

### 已完成 ✅

**引擎层**
- 图执行引擎（拓扑排序 + 波次并行 + 并发限制）
- 表达式系统 `{{nodeId.portId}}`、`{{input.xxx}}`、`{{vars.xxx}}`、`{{env.XXX}}`
- 错误策略：fail-fast / continue / pause
- 节点级重试（fixed / exponential 退避）
- 8 个内置模块：llm-chat、io-file-read、io-file-write、io-http-request、io-terminal、code-javascript、flow-condition、flow-delay
- CLI 工具（run / validate / list）
- 30 个单元测试全部通过

**服务层**
- Fastify REST API（14 个端点）
- WebSocket 实时执行事件推送
- 文件系统持久化存储

**前端**
- React Flow 可视化画布 + 拖拽添加节点
- 自定义节点渲染（分类颜色 + 端口可视化）
- JSON Schema 驱动的属性配置表单
- 撤销/重做（Ctrl+Z/Y，最多 50 步）
- 执行结果面板
- 工作流列表（加载/新建/删除/克隆/导入导出）
- 7 步新手引导 + 帮助中心（6 Tab + 416 行使用手册）

**工程**
- TypeScript strict 三包零错误
- pnpm monorepo + 一键启动脚本

## 未完成 / Roadmap

### P0 — 必须修复

| 功能 | 说明 |
|------|------|
| WebSocket 实时状态推送到 UI | 后端已实现，前端未接入，当前同步等待 |
| 连线类型校验 | 拖线时应检查端口类型兼容性 |

### P1 — 安全 & 核心功能

| 功能 | 说明 |
|------|------|
| 凭证/密钥管理 | API Key 不应明文存在工作流 JSON 里 |
| isolated-vm 沙箱 | 当前 code-javascript 用 Node.js vm（有逃逸风险） |
| 终端模块安全限制 | 命令白名单 + shell 元字符转义 |
| 文件模块路径限制 | basePath 限制 + 路径遍历防护 |
| HTTP 模块 SSRF 防护 | 禁止内网 IP + 协议限制 |
| 流式 LLM 输出 | llm-stream 模块 + UI 实时显示 |
| 循环节点 flow-loop | 设计文档已写，代码未实现 |
| Crew 模块重构 | 显式角色标注 + AbortSignal + 错误策略 |
| Server 异步执行 | POST 立即返回，后台执行 + 轮询/WS 推送 |

### P2 — 扩展功能

| 功能 | 说明 |
|------|------|
| Python 进程池 | code-python 模块 |
| 数据处理模块 | json-path、regex、template 等 |
| 工具模块 | log、uuid、timestamp 等 |
| 节点分组/子工作流 | |
| 执行历史持久化 | 当前只在内存中 |
| 测试补全 | Crew / IO / Flow 模块测试 |

### P3 — 锦上添花

| 功能 | 说明 |
|------|------|
| 触发器系统 | cron / webhook / file-watch |
| 调试模式 | 断点 + 逐步执行 |
| 暗色主题 | |
| 导出为图片 | |
| 插件系统 | 第三方模块加载 |

## 快速开始

### 前置条件

- Node.js >= 20
- pnpm >= 11

### 安装 & 启动

```bash
# 安装依赖
pnpm install

# 构建引擎
pnpm --filter @openclaw/workflow-engine build

# 启动后端（终端 1）
pnpm --filter @openclaw/workflow-server dev

# 启动前端（终端 2）
pnpm --filter @openclaw/workflow-ui dev

# 打开浏览器 http://localhost:3200
```

### CLI 直接执行工作流

```bash
node packages/workflow-engine/dist/cli.js run workflows/examples/hello-world.json --input.name=Test
```

### 运行测试

```bash
pnpm test
```

## 已知问题

1. 模块注册 `createRegistry()` 在 cli / server / ws 三处重复，需抽取为共享函数
2. 前端未接入 WebSocket，执行时同步等待无进度反馈
3. code-javascript 用 Node.js vm 模块，有原型链逃逸风险
4. API Key 明文存在工作流 JSON 中
5. 执行历史仅内存，服务重启后丢失
6. Tailwind v4 的 @import 语法兼容问题导致部分 utility class 不生效

## License

Private
