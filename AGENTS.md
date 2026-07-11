# Agent 指令

项目沟通、项目文档和面向维护者的说明尽量使用中文；代码标识符、协议字段、命令、错误信息和第三方 API 名称按其原始语言保留。

## 运行时和包管理器

使用 Bun 作为运行时、包管理器和脚本执行器。

## 简单性与必要复杂度

本仓库优先选择概念少、接口小、状态少、生命周期明确、执行路径直接的实现。复杂度必须由当前已确认的需求支付；无法说明当前必要性的代码应删除。

简单不以代码行数衡量。能够隔离第三方边界、隐藏真实复杂度或明确资源所有权的封装可以保留；引入额外状态、分支、类型参数或生命周期的短代码也不算简单。

### 实现边界

只为以下情况引入复杂度：

- 实现已确认的 PRD、issue、验收条件或对话结论。
- 防止资源泄漏或 Fiber 永久挂起。
- 保证已承诺的数据正确性、并发顺序和隔离语义。
- 正确表达 Effect 的取消、失败、资源获取与 Scope 释放。

默认不实现未确认的未来需求、调用方不需要的状态或错误分类、假想扩展点，以及仅为了“更通用”或“更完整”的设计。

公开接口应声明合法生命周期和调用顺序。默认只保证合法使用路径；违规调用会破坏模块资源、造成永久挂起或影响其他合法调用方时，才在模块内部兜底。

### 抽象与复用

- 优先直接使用 Effect、`@effect/platform` 和依赖库已有能力，不重复实现相同机制。
- 通用抽象通常需要至少两个真实用例。单一用例只有在隔离第三方 API、资源生命周期、不可信输入，或显著缩小调用方接口时才值得封装。
- 不为未来扩展、测试便利或形式上的架构完整性增加 adapter、状态层、配置、泛型或多态接口。
- 没有明确兼容要求时直接替换旧实现；新路径完成后删除旧分支、overload、类型和测试。
- fake 实现真实公开 seam，并放在测试目录，不为测试扩大生产接口。

### 测试与审查

- 测试已确认的公开行为，以及实现中真实存在的取消、资源释放、并发顺序和永久挂起风险。
- 不断言私有 Queue、Ref、Deferred、Fiber 或内部状态。
- 未承诺的调用方式和负向架构约束通过 review 验证，不编写实现耦合的运行时测试。
- 实现与 review 必须检查：是否超出需求、重复已有能力、保留无用旧路径，或新增调用方不需要的状态、错误分类、配置和抽象。
- 确需偏离时记录具体需求与理由；“更通用”“更完整”和“以后可能需要”不是理由。

## Effect-first 实现原则

本仓库优先使用 Effect v3 表达副作用、并发、错误、资源生命周期与领域集合。先遵守“简单性与必要复杂度”原则，再为必要行为选择合适的 Effect 原语。目标是让取消、失败、资源释放和测试时钟保持可组合、可推理；不是给纯同步计算机械包裹 `Effect`。

### 副作用与异步边界

- I/O、异步操作、可恢复失败、重试、超时、资源申请与释放必须进入 `Effect`。
- 业务实现不要直接组合原生 `Promise`。第三方 Promise API 应隔离在 adapter 边界，并通过 `Effect.tryPromise` 等 API 转换。
- 外部不可信输入优先使用 `Schema` 解码；预期内的业务失败使用 Effect error channel，不以抛异常表达。

### 并发、通信与状态

- Fiber 间 FIFO 通信使用 `Queue`，广播使用 `PubSub`，一次性协调使用 `Deferred`，并发限制使用 Effect `Semaphore`。
- 并发共享状态优先使用 `Ref`、`SynchronizedRef` 或 `SubscriptionRef`；不要手写锁、waiter、listener 或用普通数组模拟队列。
- 领域映射与集合优先使用 Effect 的不可变 `HashMap`、`HashSet`；需要并发更新时，将不可变集合放入合适的 Effect Ref 中。
- `MutableHashMap`、`MutableHashSet` 仅用于模块内部、明确受控的可变热路径，不能替代并发状态原语。
- 原生 `Map`、`Set` 只用于局部、同步、短生命周期且不跨 Fiber 共享的实现细节。若用于长期领域状态、服务索引或跨 Effect 操作保留的状态，应优先改用 `HashMap`、`HashSet` 或 Effect Ref；确需保留原生集合时说明理由。

### 生命周期、时间与流

- 资源使用 `Scope`、`Effect.acquireRelease` 或 `Layer` 管理，后台 Fiber 优先使用 `Effect.forkScoped`。
- 禁止无归属的永久 Fiber；`forkDaemon` 只用于明确的进程级生命周期，并需说明理由。
- 时间、超时和重试使用 `Clock`、`Effect.sleep`、`Schedule`；测试使用 `TestClock`，不要依赖真实等待。
- 连续或增量数据优先使用 `Stream`、`Sink`、`Channel`，不要手写回调广播、Promise 消费循环或 async iterator 来替代已有 Effect 抽象。

### 原生代码的允许范围

- 纯同步计算、局部临时值、第三方 API adapter 和有证据支持的性能热点可以使用原生语言能力。
- 原生结构不能承担 Fiber 通信、背压、取消、资源生命周期或并发共享状态。
- 当 Effect 已有合适原语但仍选择原生 Promise、timer、event emitter、集合或手写并发结构时，需在代码或设计文档中记录原因，并测试取消、失败与资源释放行为。

### 实现与审查

- 设计或实现前先识别 Effect 已有的服务、数据类型和并发原语；按下文要求优先查阅 vendored Effect 源码与测试。
- Code review 必须检查手写异步、队列、广播、锁、timer、重试、可变集合和资源管理是否可由 Effect 原语替代。
- 测试优先通过公开 Effect seam、真实 `Scope`、可控服务与 `TestClock` 验证行为，不断言内部 Ref、Queue、PubSub 或 Fiber。

## 外部源码参考

`repos/effect/` 通过 Git subtree 引入 `Effect-TS/effect` 的 Effect v3 源码，版本必须与项目实际安装的 `effect` 版本保持一致。

- 编写或审查 Effect 代码时，优先检查 `repos/effect/packages/effect/src/` 中的实现和 `repos/effect/packages/effect/test/` 中的测试，再按需查阅相关包的 README。
- 将 `repos/effect/` 视为只读参考资料；除非任务明确要求，否则不要修改其中的文件。
- 不要从 `repos/effect/` 导入任何模块；项目代码必须继续使用 `package.json` 中声明的依赖。
- 更新 `effect` 依赖时，同步更新此 subtree 到相同版本的 `effect@<version>` tag。

同步上游源码时使用：

```sh
git subtree pull --prefix=repos/effect https://github.com/Effect-TS/effect.git effect@3.21.4 --squash
```

## Agent 技能

### Issue tracker

Issues 和 PRDs 使用 `.scratch/` 下的本地 Markdown 文件管理；外部 PR 不作为 triage 入口。详见 `docs/agents/issue-tracker.md`。

### Triage 标签

本仓库使用默认的五角色 triage 词汇：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human` 和 `wontfix`。详见 `docs/agents/triage-labels.md`。

### 领域文档

本仓库是面向 Effect v3 工具封装的 multi-context monorepo：根目录的 `CONTEXT-MAP.md` 指向各 context 自己的 `CONTEXT.md`。详见 `docs/agents/domain.md`。
