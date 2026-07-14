# React Query 适配

`@pkg/http-api-client/react-query` 将 Effect HttpApiClient endpoint 接入 TanStack React Query，同时保留 TanStack Query 的缓存、retry 和状态语义。

## Query descriptor

```ts
import { makeEffectQueryOptions } from "@pkg/http-api-client/react-query"

export const getUserQuery = makeEffectQueryOptions(
  ApiClient,
  (client) => client.users.get,
  "GET:users.get",
)

const options = getUserQuery.options({
  path: { id: "u-1" },
  urlParams: { include: "profile" },
})
```

`queryKey` 固定为 `[key, request]`。request 从 endpoint 推导，只允许 JSON 形式的 `path`、`urlParams` 与 `payload`；headers、FormData 和 `withResponse` 不在此边界内。

Query 与 Mutation descriptor 的 key 必须是非空静态字符串 literal。普通 `string` 或包含动态 `string` 的模板 literal 会产生类型错误；JavaScript 或类型断言绕过限制后传入的空字符串，会在 descriptor 构造时抛出 `TypeError`。

## Runtime 与 React

```tsx
import { ManagedRuntime } from "effect"
import { useHydrated } from "@tanstack/react-router"
import { makeEffectReactRuntime } from "@pkg/http-api-client/react-query"
import { BrowserLive, type BrowserServices } from "./browser-live"

export const EffectReact = makeEffectReactRuntime<BrowserServices>()
export const browserRuntime = ManagedRuntime.make(BrowserLive)

export const Root = ({ children }: { children: React.ReactNode }) => {
  const hydrated = useHydrated()

  return (
    <EffectReact.Provider runtime={hydrated ? browserRuntime : undefined}>
      {children}
    </EffectReact.Provider>
  )
}

export const User = () => {
  const query = EffectReact.useEffectQuery(
    getUserQuery.options({ path: { id: "u-1" } }),
  )

  return <pre>{JSON.stringify(query.data)}</pre>
}
```

`makeEffectReactRuntime<R>()` 固定该 React context 可以提供的 Effect Service 类型，返回共享同一 runtime context 的 Provider、Query 与 Mutation hooks。`Provider` 同步接收应用已经创建的 `ManagedRuntime<R, unknown>` 句柄；它不会构建 Layer，也不拥有 runtime 的释放。`ManagedRuntime` 在第一次执行 Effect 时才构建 Layer，应用应在自身生命周期结束时调用 `dispose()`。

缺失 runtime 时，`useEffectQuery` 使用 TanStack `skipToken` 并保持 idle。`useRunner` 在 Provider 外只可执行不需要业务环境的 Effect，并回退到 `Runtime.defaultRuntime`；依赖业务 Service 的 mutation 会失败为 `EffectDefect`。

SSR 应保证服务端渲染与客户端首次 hydration 使用相同的 Provider 值。如果 Browser Runtime 只存在于客户端，保留 `useHydrated()` gate：服务端与客户端首次渲染都传入 `undefined`，hydration 完成后才传入 Browser Runtime。直接在客户端首次渲染传入 runtime，可能让 query 的 `status`、`fetchStatus` 或 Suspense 输出与 SSR HTML 不一致。

### TanStack Start 客户端 Runtime

下面的结构验证了 Browser Layer 在 hydration 后才对 query 可用。`BrowserLive` 可以在 Layer 构建时读取 `localStorage` 等浏览器 API；服务端 Router Context 始终得到 `undefined`。

```ts
// effect-runtime.ts
import {
  makeEffectReactRuntime,
  type EffectRuntimeHandle,
} from "@pkg/http-api-client/react-query"
import type { ApiClient } from "./api-client"
import type { BrowserCache } from "./browser-cache"

export type BrowserServices = ApiClient | BrowserCache
export type BrowserRuntime = EffectRuntimeHandle<BrowserServices>

export const EffectReact = makeEffectReactRuntime<BrowserServices>()
```

```ts
// browser-runtime.ts — 只从客户端入口导入
import { Layer, ManagedRuntime } from "effect"
import { ApiClient } from "./api-client"
import { BrowserCache } from "./browser-cache"

const BrowserLive = Layer.merge(ApiClient.Default, BrowserCache.Default)

export const browserRuntime = ManagedRuntime.make(BrowserLive)
```

TanStack Start 的 `hydrateStart()` 不接收 Router Context 参数，因此客户端入口需要在它创建 route matches 之前，把 runtime 放到 router factory 可同步读取的位置：

```ts
// browser-runtime-slot.ts — 同构模块，服务端进程中保持 undefined
import type { BrowserRuntime } from "./effect-runtime"

let browserRuntime: BrowserRuntime | undefined

export const getBrowserRuntime = () => browserRuntime

export const setBrowserRuntime = (runtime: BrowserRuntime) => {
  browserRuntime = runtime
}
```

```tsx
// client.tsx — TanStack Start 自定义客户端入口
import { Await, RouterProvider } from "@tanstack/react-router"
import { hydrateStart } from "@tanstack/react-start/client"
import { StrictMode, startTransition } from "react"
import { hydrateRoot } from "react-dom/client"
import { browserRuntime } from "./browser-runtime"
import { setBrowserRuntime } from "./browser-runtime-slot"

setBrowserRuntime(browserRuntime)

let hydration: ReturnType<typeof hydrateStart> | undefined

function Client() {
  hydration ??= hydrateStart()

  return (
    <Await
      promise={hydration}
      children={(router) => <RouterProvider router={router} />}
    />
  )
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => void browserRuntime.dispose())
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <Client />
    </StrictMode>,
  )
})
```

```tsx
// router.tsx
import { QueryClient } from "@tanstack/react-query"
import { createRouter } from "@tanstack/react-router"
import { getBrowserRuntime } from "./browser-runtime-slot"
import type { BrowserRuntime } from "./effect-runtime"
import { routeTree } from "./routeTree.gen"

export type RouterContext = {
  readonly queryClient: QueryClient
  readonly browserRuntime?: BrowserRuntime
}

export function getRouter() {
  return createRouter({
    routeTree,
    context: {
      queryClient: new QueryClient(),
      browserRuntime: getBrowserRuntime(),
    } satisfies RouterContext,
  })
}
```

```tsx
// routes/__root.tsx
import { Outlet, createRootRouteWithContext, useHydrated } from "@tanstack/react-router"
import { EffectReact } from "../effect-runtime"
import type { RouterContext } from "../router"

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Root,
})

function Root() {
  const hydrated = useHydrated()
  const { browserRuntime } = Route.useRouteContext()

  return (
    <EffectReact.Provider runtime={hydrated ? browserRuntime : undefined}>
      <Outlet />
    </EffectReact.Provider>
  )
}
```

不能在 `hydrateStart()` 返回后再调用 `router.update({ context })`：已水合的 route match 可能继续持有旧 context。也不要在 `hydrateRoot()` 前顶层 `await hydrateStart()`；应像官方 `StartClient` 一样在 React `<Await>` 中等待 hydration Promise。

## Mutation descriptor

```tsx
import { makeEffectMutationOptions } from "@pkg/http-api-client/react-query"

export const updateUserMutation = makeEffectMutationOptions(
  ApiClient,
  (client) => client.users.update,
  "PATCH:users.update",
)

export const UpdateUser = () => {
  const mutation = EffectReact.useEffectMutation({
    ...updateUserMutation.options(),
    onSuccess: (_user, variables, _result, { client }) =>
      client.invalidateQueries({ queryKey: ["GET:users.get"] }),
  })

  return (
    <button
      onClick={() =>
        mutation.mutate({
          path: { id: "u-1" },
          payload: { name: "Ada" },
        })
      }
    >
      保存
    </button>
  )
}
```

Mutation variables 从 endpoint request 推导，支持 `path`、`urlParams`、`payload`、`headers` 与 FormData，并固定排除 `withResponse`。无输入 endpoint 使用 `mutate()`。除 descriptor 固定的 `mutationKey` 与 `mutationFn` 外，retry、scope 和 callbacks 等配置保持 TanStack Mutation 原生语义；缓存更新与失效由调用方在 callbacks 中显式完成。

`useEffectQuery` 与 `useEffectMutation` 在执行 endpoint Effect 时使用 key 的第一项建立 `Effect.withSpan`，因此 descriptor key 同时是 tracing span 名。

应用负责创建与释放 runtime。Provider 的 runtime 缺失时 `useEffectQuery` 使用 TanStack `skipToken`。`useEffectMutation` 仍返回原生 mutation result，但提交需要业务 Service 的 mutation 时会通过默认 runtime 失败为 `EffectDefect`。

Effect 的单一业务失败保持原始错误，defect、中断和组合 Cause 转为 `EffectDefect`。当前不复刻 Query `initialData` 的 defined-result overload。
