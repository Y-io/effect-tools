# Effect-first 实现与审查

先遵守根 `AGENTS.md` 的“简单性与必要复杂度”原则，再为必要行为选择 Effect v3 原语。不要给纯同步计算机械包裹 `Effect`，也不要为未确认需求预建抽象。

## 副作用与错误

- I/O、异步、可恢复失败、重试、超时和资源生命周期必须进入 `Effect`。
- 第三方 Promise API 只保留在 adapter 边界，并通过 `Effect.tryPromise` 等 API 转换；业务实现不直接组合原生 `Promise`。
- 外部不可信输入优先用 `Schema` 解码；预期业务失败使用 error channel，不以抛异常表达。

## 并发与状态

- FIFO 通信用 `Queue`，广播用 `PubSub`，一次性协调用 `Deferred`，并发限制用 Effect `Semaphore`；不要手写锁、waiter、listener 或数组队列。
- 跨 Fiber 共享状态用 `Ref`、`SynchronizedRef` 或 `SubscriptionRef`。
- 长期领域状态与跨 Effect 保留的集合优先用不可变 `HashMap`、`HashSet` 并放入合适的 Ref；原生 `Map`、`Set` 仅限局部、同步、短生命周期细节。
- `MutableHashMap`、`MutableHashSet` 仅用于模块内部有证据支持的可变热路径，不能代替并发状态原语。

## 生命周期、时间与流

- 资源用 `Scope`、`Effect.acquireRelease` 或 `Layer` 管理；后台 Fiber 优先 `Effect.forkScoped`。禁止无归属的永久 Fiber；`forkDaemon` 仅用于有明确理由的进程级生命周期。
- 时间、超时和重试用 `Clock`、`Effect.sleep`、`Schedule`；测试用 `TestClock`，不依赖真实等待。
- 连续或增量数据优先用 `Stream`、`Sink`、`Channel`，不手写回调广播、Promise 消费循环或 async iterator 替代已有抽象。
- 原生语言能力可用于纯同步计算、局部临时值、第三方 adapter 和有证据支持的性能热点，但不能承担 Fiber 通信、取消、背压或资源生命周期。

## 实现与测试

- 设计或实现前先检查 Effect 是否已有对应服务、数据类型或并发原语。
- 测试通过公开 Effect seam、真实 `Scope`、可控服务和 `TestClock` 验证行为，不断言内部 Ref、Queue、PubSub 或 Fiber。
- 选择原生 Promise、timer、event emitter、集合或手写并发结构替代已有 Effect 原语时，记录具体理由，并测试取消、失败和资源释放。
- Code review 检查手写异步、通信、锁、时间、重试、可变集合和资源管理是否可由 Effect 原语替代。

## Vendored Effect 源码

`repos/effect/` 以 Git subtree 提供与项目依赖同版本的 Effect v3 源码，只用于参考。

- 编写或审查 Effect 代码时，优先查阅 `repos/effect/packages/effect/src/` 和 `repos/effect/packages/effect/test/`，再按需查阅相关 README。
- 除非任务明确要求，不修改 `repos/effect/`，也不从中导入模块；项目代码使用 `package.json` 声明的依赖。
- 更新 `effect` 依赖时，同步更新 subtree 到相同的 `effect@<version>` tag。

```sh
git subtree pull --prefix=repos/effect https://github.com/Effect-TS/effect.git effect@3.21.4 --squash
```
