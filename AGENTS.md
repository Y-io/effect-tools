# Agent 指令

项目沟通、项目文档和面向维护者的说明尽量使用中文；代码标识符、协议字段、命令、错误信息和第三方 API 名称按其原始语言保留。

## 运行时和包管理器

使用 Bun 作为运行时、包管理器和脚本执行器。

## 简单性与必要复杂度

优先选择概念少、接口小、状态少、生命周期明确、执行路径直接的实现。复杂度必须由当前已确认的需求支付；无法说明当前必要性的代码应删除。

- 只为已确认行为、资源安全、数据正确性以及 Effect 的取消、失败与 Scope 释放引入复杂度。
- 优先复用 Effect、`@effect/platform` 和依赖库已有能力，不重复封装相同机制。
- 通用抽象通常需要至少两个真实用例；隔离第三方 API、资源生命周期或不可信输入的边界除外。
- 不为未来扩展、测试便利、调用方不需要的状态或违规调用增加生产复杂度；违规会破坏模块资源或其他合法调用方时才兜底。
- 没有明确兼容要求时直接替换旧实现，并删除旧分支、overload、类型和测试。
- 测试已确认的公开行为与实现中真实存在的风险，不断言私有 Queue、Ref、Deferred、Fiber 或内部状态。

## Effect 实现

涉及 Effect 副作用、并发、状态、时间、流或资源生命周期的设计、实现与审查，必须先阅读 [`docs/agents/effect-first.md`](docs/agents/effect-first.md)。

## 项目约定入口

- Issues 与 PRDs：[`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md)
- Triage 状态：[`docs/agents/triage-labels.md`](docs/agents/triage-labels.md)
- 多 context 领域文档：[`docs/agents/domain.md`](docs/agents/domain.md) 与 [`CONTEXT-MAP.md`](CONTEXT-MAP.md)
