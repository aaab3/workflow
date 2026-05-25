# OpenClaw Workflow — 改进计划

> 基于 REVIEW.md 评审结果，按 P0→P1→P2 优先级逐步改进。

---

## P0：安全加固

### 1. JavaScript 模块沙箱加固
**文件**: `packages/workflow-engine/src/modules/code/javascript.ts`

**现状**: 使用 `node:vm` 的 `runInNewContext`，可通过原型链逃逸。

**改进方案**:
- 使用 Worker Thread 隔离执行（`node:worker_threads`）
- 设置 `--no-addons`、`--experimental-permission` 限制
- 添加内存限制（`resourceLimits`）
- 超时后强制终止 Worker
- 禁止 `require`、`import`、`process`、`global` 访问

### 2. 终端模块安全限制
**文件**: `packages/workflow-engine/src/modules/io/terminal.ts`

**现状**: `shell: true` 默认开启，无命令白名单。

**改进方案**:
- 添加 `allowedCommands` 配置（白名单模式）
- 添加 `blockedPatterns` 配置（黑名单模式，默认禁止 rm -rf、curl 内网等）
- 默认 `shell: false`，需要 shell 特性时显式开启
- 对命令参数做 shell 元字符转义

### 3. 文件模块路径限制
**文件**: `packages/workflow-engine/src/modules/io/file-read.ts`, `file-write.ts`

**现状**: 可读写任意路径。

**改进方案**:
- 添加 `basePath` 配置（限制在工作目录内）
- 路径规范化后检查是否在 basePath 内（防止 `../` 遍历）
- 添加文件大小限制（默认 10MB）
- 禁止读取敏感路径模式（`.env`、`.ssh`、`/etc/shadow` 等）

### 4. HTTP 模块 SSRF 防护
**文件**: `packages/workflow-engine/src/modules/io/http-request.ts`

**现状**: 可请求任意 URL 包括内网。

**改进方案**:
- 解析 URL 的 IP 地址，禁止内网 IP 段（10.x、172.16-31.x、192.168.x、127.x、169.254.x）
- 禁止 `file://`、`ftp://` 等非 HTTP 协议
- 添加响应大小限制（默认 50MB）
- 添加可配置的域名白名单

### 5. 安全配置中心
**文件**: 新建 `packages/workflow-engine/src/security.ts`

**方案**:
- 创建 `SecurityConfig` 接口，集中管理所有安全策略
- 通过 `EngineOptions` 传入，各模块通过 `ExecutionContext` 访问
- 默认策略为"严格模式"，可按需放宽

---

## P1：Crew 模块重构

### 6. 显式角色标注
**文件**: `packages/workflow-engine/src/crew/types.ts`, `crew-engine.ts`

**现状**: Agent 角色由数组位置决定。

**改进方案**:
- 在 `AgentDef` 中添加 `roleType` 字段：`"worker" | "dispatcher" | "merger" | "lead" | "reviewer" | "judge" | "proposer" | "aggregator"`
- 各模式通过 `roleType` 查找对应 Agent，而非数组下标
- 保留数组顺序作为 fallback（向后兼容）
- 添加校验：模式所需的角色必须存在

### 7. Prompt 模板化 + 国际化
**文件**: 新建 `packages/workflow-engine/src/crew/prompts.ts`

**现状**: 中文 prompt 硬编码在执行逻辑中。

**改进方案**:
- 抽取所有 prompt 到独立模板文件
- 支持 `CrewDef.locale` 配置（默认 "zh"，支持 "en"）
- 支持 `CrewDef.promptOverrides` 自定义模板
- 模板使用 `{{variable}}` 占位符

### 8. AbortSignal 支持
**文件**: `packages/workflow-engine/src/crew/crew-engine.ts`

**现状**: 无法取消正在执行的 Crew。

**改进方案**:
- `execute()` 方法接受 `signal?: AbortSignal` 参数
- 每次 Agent 调用前检查 `signal.aborted`
- 将 signal 传递给 `fetch` 调用
- 取消时设置 `execution.status = "cancelled"`

### 9. 错误策略
**文件**: `packages/workflow-engine/src/crew/crew-engine.ts`

**现状**: 一个 Agent 失败整个 Crew 崩溃。

**改进方案**:
- 在 `CrewDef` 中添加 `errorStrategy: "fail-fast" | "continue" | "skip-agent"`
- `continue`: 记录错误但继续执行其他 Agent
- `skip-agent`: 跳过失败的 Agent，用 fallback 值替代
- Parallel 模式下部分 Agent 失败不影响其他 Agent 的结果

### 10. FlowDef 真正生效
**文件**: `packages/workflow-engine/src/crew/crew-engine.ts`

**现状**: `FlowDef` 类型定义了但没有使用。

**改进方案**:
- Pipeline 模式：如果有 FlowDef，按 FlowDef 定义的顺序执行（而非数组顺序）
- 支持条件路由：`FlowDef.condition` 决定是否传递数据
- 支持数据选择：`FlowDef.data` 指定传递哪个输出字段

---

## P1：Server 修复

### 11. 异步执行
**文件**: `packages/workflow-server/src/routes/executions.ts`

**现状**: 同步等待工作流执行完成。

**改进方案**:
- POST 立即返回 `{ executionId, status: "running" }`
- 后台执行工作流
- 通过 GET `/api/executions/:id` 轮询状态
- 通过 WebSocket 实时推送事件

### 12. 内存泄漏修复
**文件**: `packages/workflow-server/src/routes/executions.ts`

**现状**: `executions` Map 只增不减。

**改进方案**:
- 执行完成后设置 TTL（默认 30 分钟后从内存移除）
- 添加 LRU 策略，内存中最多保留 50 条
- 已持久化到磁盘的记录从内存中移除

### 13. 请求校验
**文件**: `packages/workflow-server/src/routes/workflows.ts`, `executions.ts`

**改进方案**:
- 使用 Fastify 的 JSON Schema 校验
- 限制请求体大小（默认 1MB）
- 校验 workflow 结构完整性

---

## P2：测试补全

### 14. Crew 模块测试
**文件**: 新建 `packages/workflow-engine/__tests__/crew.test.ts`

**方案**:
- Mock `runAgent` 函数（不实际调用 LLM）
- 测试每种模式的执行流程
- 测试早停条件
- 测试错误处理和重试
- 测试 AbortSignal 取消

### 15. IO 模块测试
**文件**: 新建 `packages/workflow-engine/__tests__/modules-io.test.ts`

**方案**:
- file-read/write: 使用临时目录
- http-request: Mock fetch
- terminal: Mock child_process

### 16. Flow 模块测试
**文件**: 新建 `packages/workflow-engine/__tests__/modules-flow.test.ts`

**方案**:
- condition: 测试所有运算符
- loop: 测试 forEach 和 while 模式
- delay: 测试超时

---

## 执行顺序

1. 创建 `security.ts` 安全配置中心
2. 改进 JavaScript 模块（Worker Thread）
3. 改进终端模块（白名单 + 转义）
4. 改进文件模块（路径限制）
5. 改进 HTTP 模块（SSRF 防护）
6. 重构 Crew 类型（roleType + prompts）
7. 重构 Crew 引擎（AbortSignal + 错误策略 + FlowDef）
8. 修复 Server 异步执行 + 内存泄漏
9. 补全测试
