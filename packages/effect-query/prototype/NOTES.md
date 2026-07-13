# Effect Query prototype notes

## Question

纯 `effectQueryOptions` 与依赖共享 runtime 的 `useEffectQuery` 能否保持清晰的配置/执行分离？

## Initial findings

- `makeEffectQueryOptions(Service, selector, key)` 返回 `{ key, options }`；selector 先推导 HttpApiClient endpoint，最后一个 key 参数保留 literal。`options(request)` 生成配对的 `{ queryKey, queryFn }`，无参数 endpoint 使用 `options()` 与空 object key。
- 显式 key 的 literal 类型会贯穿 descriptor 与最终 query key tuple；不依赖原始 HttpApi metadata。
- 分离本身很直接：options 保留 Query Effect，hook 在调用 `useQuery` 前将它转换为 Promise query function。
- `Runtime.runPromise(runtime, effect, { signal })` 已原生桥接 `AbortSignal`，无需额外取消机制。
- 普通 React context 无法从祖先 Provider prop 向深层 hook 传播 `R`；`makeEffectQueryRuntime(runtimeLoader)` 因此在创建应用实例时从 loader 推导并固定环境类型。Provider 只传播 `enabled`，不再保存或擦除 loader 类型；返回的 `useRuntime`、`useRunner` 与 `useEffectQuery` 共享同一个类型化 loader。
- Provider 不在 render 时执行 loader。Provider 缺失或 disabled 时，`useRunner` 回退 `Runtime.defaultRuntime`；`useEffectQuery` 改用 TanStack `skipToken`，不会用默认 runtime 执行缺少 HttpApiClient Service 的 endpoint。
- React 运行测试已验证：Provider SSR render 不执行 loader、`useRunner` 默认 runtime、loader rejection 转 `QueryDefect`、缺少 loader 时 query 保持 idle 且 queryFn 不执行、有 loader 时 query 成功执行。
- 真实 HttpApiClient 端到端测试已验证：由 `HttpApiClient.make` 构造的 Service 经 `ManagedRuntime`、`makeEffectQueryOptions` 与 `useEffectQuery` 发出实际 HTTP 请求；嵌套 `path`、`urlParams`、`payload` 同时正确进入 query key 和 wire request，成功响应完成 Schema 解码，404 的 `UserNotFound` 仍以原始业务错误进入 TanStack Query。
- 转换已改用 `Runtime.runPromiseExit`：单一 `Fail` 以原始 `E` rejection，其余 Cause 以 `QueryDefect` rejection，TanStack error 类型为 `E | QueryDefect`。
- 实际运行已验证：通过 runtime 取得 Service 后执行 endpoint；`Effect.fail` 产生原始业务错误；把 TanStack signal 传给 `Runtime.runPromiseExit` 可中断 `Effect.never`，中断 Cause 转为 `QueryDefect`。
- Effect `HttpApiClient` request 可同时包含嵌套的 `path`、`urlParams`、`payload`、`headers` 与 `withResponse`。JSON 形态可直接作为 input，但 multipart endpoint 的 `FormData` 不满足 JSON key 约束。
- `HttpApiClient` endpoint method 因 `withResponse` 而是泛型函数。专用 overload 将 query 固定为默认 `withResponse = false`，原型已能通过 `Effect.Service` 与 `(client) => client.group.endpoint` 同时推导 request、业务数据、错误与环境类型。
- HttpApiClient method overload 的类型矩阵：无参数 method 归一化为 `{}`；嵌套与联合的 `path` / `urlParams` / `payload` 可直接传；必需 headers 与 FormData 被拒绝。
- 分阶段 descriptor 避免了同一 options object 内的反向推导；直接 Effect、任意函数与直接 endpoint method 形式已从工厂边界删除。
- descriptor options 带内部 brand，`useEffectQuery` 无法接受调用方手写的任意 Effect options；`runEffect` 与 runtime-to-TanStack 转换也不作为包级 API 导出。
- 参考实现 `/Users/henry/Documents/github/effect-monorepo/packages/client/src/lib/tanstack-query` 使用回调手工调用 endpoint，并未直接接收 endpoint method；其 `runPromiseExit`、原始 `E` 与 `QueryDefect` 的错误分流值得沿用。
- 最小 TanStack Start 1.168 原型已把 Provider 放在 `__root.tsx`：生产 client/server build 通过，server bundle 不包含 `runtime.client`；真实 SSR fetch 返回 200，Provider 被渲染且 query 为 `pending/idle`，浏览器 runtime 与 queryFn 未执行。
- 真实浏览器 hydration 已验证：`useHydrated()` 切换为 true 后动态 import runtime，query 最终为 `success/idle`，数据为 `"client-runtime"`。

## Verdict

配置/执行分离可行，且由 factory 绑定的 lazy runtime loader 能兼容 TanStack Start 的 SSR 与客户端 hydration，并静态限制 hooks 所需的 Effect 环境；真实 HttpApiClient 的请求编码、响应解码与业务错误传播也已贯通。该原型已转成第一阶段正式实现：提供 query/runtime API，runtime 生命周期由应用负责，首版不承担 TanStack `initialData` defined-result overload。实现测试已经覆盖取消、defect/composite Cause 与 retry 风险。

`useEffectMutation` 明确推迟到下一阶段，并单独设计 mutation variables、错误、并发与缓存失效语义。
