# HttpApiClient

为基于 `HttpApi` 生成的类型化客户端定义 Runtime 级请求变换、原始响应观察与 React Query 适配，同时保持具体业务协议与状态的归属边界。

## Language

**请求提供者（Request Provider）**：
每次请求发送前，按声明顺序读取当前 Runtime 能力并将一个不可变请求变换为下一个不可变请求的函数；后一个请求提供者观察前一个的完整结果。
_Avoid_: 请求拦截器、Request Interceptor、Middleware

**Header 提供者（Headers Provider）**：
一种请求提供者，每次请求时生成一组 headers 并合并进当前请求；它仍参与请求提供者的同一条有序管线。
_Avoid_: Header 拦截器、Headers Interceptor

**响应提供者（Response Provider）**：
Schema 解码前，按声明顺序观察同一个原始响应并执行 Effect 的函数；它不替换响应，失败会中止后续响应处理。
_Avoid_: 响应拦截器、Response Interceptor、Middleware

**Effect–TanStack Query 适配层（Effect–TanStack Query Adapter）**：
在 TanStack Query 与 Effect HttpApiClient endpoint 之间转换请求类型、执行、依赖和取消语义的薄边界；缓存、重试、失效与请求状态仍属于 TanStack Query。它从独立的 `@pkg/http-api-client/react-query` 子路径导出，根入口保持 React 无关。
_Avoid_: 数据获取框架、Query 框架、React Query 封装层

**Effect Query Runtime Instance**：
由 `makeEffectQueryRuntime(runtimeLoader)` 创建的应用绑定实例，从 loader 返回的 `Runtime.Runtime<R>` 推导并固定环境类型，返回同一 React context 上的 `Provider`、`useRuntime`、`useRunner` 与 `useEffectQuery`。`Provider` 只接收 `enabled`，不接收或执行 loader，因此可以同构渲染；`useRuntime` 在 Provider 启用时返回类型化 loader，否则返回 `undefined`；`useRunner` 专门等待 loader、为 Effect 提供其环境并执行，在 loader 不存在时只回退到 `Runtime.defaultRuntime`；`useEffectQuery` 使用同一实例判断 runtime 是否启用。实例不构建 Layer，也不拥有 runtime 的释放。
_Avoid_: 包级 Runtime 单例、业务 Service 专用 Provider

**Effect Runtime Loader**：
应用组合层提供的惰性函数，返回已初始化的原始 `Runtime.Runtime<R>` 或其 Promise；它允许应用在浏览器条件成立后动态加载 `ManagedRuntime` 并调用 `.runtime()`，也允许注入独立的服务器 runtime。适配层不依赖 Router Context 或 `ManagedRuntime` 的 Layer 构建错误类型。
_Avoid_: 静态 import 浏览器 runtime、在适配层构建 Layer

**Missing Runtime Query**：
Provider 缺失或 `enabled = false` 时，HttpApiClient endpoint query 使用 TanStack Query `skipToken`，不尝试用 `Runtime.defaultRuntime` 执行缺少 Service 的 Effect；默认 runtime 只属于通用 `useRunner` 的回退行为。
_Avoid_: SSR 时执行缺少 Service 的 endpoint、用默认 runtime 掩盖缺失依赖

**Effect Query Key**：
由用户在 `makeEffectQueryOptions` 最后一个参数填写的字符串名称与必需的 JSON object 请求组成的只读二元组；名称在类型上仅约束为 `string` 并保留传入的 literal 类型，`METHOD:group.name` 只是文档推荐格式，不由类型系统强制或提示。请求类型从此前选定的 HttpApiClient endpoint method 提取，但只包含 `path`、`urlParams` 与 `payload`，无输入的 endpoint 使用空 object；headers、`withResponse` 与非 JSON 值不属于 key。
_Avoid_: 任意 QueryKey、参数数组

**Query Descriptor**：
由 `makeEffectQueryOptions` 依次从 HttpApiClient Service、endpoint selector 与最后一个显式名称建立的不可变描述；该顺序先完成 endpoint 类型推导，再约束并保留名称类型。描述仅提供名称与 options 构造函数；options 构造函数接收推导后的 endpoint 请求，并返回带内部 brand 的配对 query key 与固定 `withResponse = false` 的 query function。`useEffectQuery` 只接受这种构造结果，避免调用方意外手写 options；调用方仍可像普通 TanStack options 一样基于返回值扩展配置，但不应替换 descriptor 生成的 `queryFn`。
_Avoid_: 手写 TanStack Query options、Endpoint metadata

**Query Endpoint**：
可接入 React Query 的 HttpApiClient endpoint method；其请求只能由 JSON 形式的 `path`、`urlParams` 与 `payload` 构成，并固定使用 `withResponse = false`。要求显式 headers 或 FormData 的 endpoint 不属于该边界。
_Avoid_: 任意 Effect 函数、原生 queryFn、Promise factory

**Mutation Descriptor**：
由 `makeEffectMutationOptions` 从 HttpApiClient Service、endpoint selector 与显式字符串名称建立的不可变描述。它与 Query descriptor 同样返回 `key` 与 `options()`；生成的 `mutationKey` 固定为 `[key]`，`mutationFn` 保留 Effect，直到 `useEffectMutation` 边界才通过应用 runtime 执行。调用方通过 spread 添加 TanStack 原生 Mutation options，适配层不包装 callbacks 或缓存失效规则。
_Avoid_: 手写 TanStack mutationFn、自动缓存失效、Mutation DSL

**Mutation Variables**：
从 HttpApiClient endpoint 的完整 request 推导并固定排除 `withResponse`；允许 `path`、`urlParams`、`payload`、`headers` 与 FormData。无输入 endpoint 使用 `void`，允许直接调用 `mutate()`。variables 不进入 Query cache key，因此不承担 Query descriptor 的 JSON 限制。
_Avoid_: 复用 Query input 限制、强制空 object、响应 tuple 开关

**Mutation Concurrency**：
完全沿用 TanStack Mutation：默认并行，相同 `scope.id` 串行；适配层不增加 Effect Semaphore、队列、latest-wins 或自动中断。缓存更新和失效由调用方使用 TanStack callbacks 与 QueryClient 显式完成。
_Avoid_: 自定义并发策略、隐式 invalidation

**Effect Defect**：
交给 TanStack Query 与 Mutation 的错误联合 `E | EffectDefect`。单一 `Effect.fail(E)` 保留 endpoint 的原始业务错误值与联合类型；defect、interruption、组合 Cause 与 runtime loader 异常才包装为持有底层 cause 的 `EffectDefect`，不把所有 endpoint error 统一包装。
_Avoid_: 统一 API 错误包装、丢失 endpoint error union

**Endpoint Span**：
`useEffectQuery` 与 `useEffectMutation` 在调用 runtime runner 前以 `queryKey[0]` 或 `mutationKey[0]` 包裹 `Effect.withSpan`。descriptor 的必填字符串 key 因此同时作为稳定 span 名；TanStack retry 每次重新执行 Effect 时独立建立 span。
_Avoid_: 将 request variables 或 payload 拼入 span 名

## React Query implementation scope

实现 Query 与 Mutation descriptors，以及 `makeEffectQueryRuntime` 返回的 `Provider`、`useRuntime`、`useRunner`、`useEffectQuery` 与 `useEffectMutation`。runtime 由应用创建并负责释放；适配层只惰性取得并使用它。当前不承担 TanStack Query 的 `initialData` defined-result overload，也不透传 hooks 的第二个 QueryClient 参数。
