# @pkg/effect-query

将 Effect HttpApiClient endpoint 接入 TanStack React Query，同时保留 TanStack Query 的缓存、retry 和状态语义。

## Query descriptor

```ts
import { makeEffectQueryOptions } from "@pkg/effect-query"

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

## Runtime 与 React

```tsx
import { makeEffectQueryRuntime } from "@pkg/effect-query"

export const EffectQuery = makeEffectQueryRuntime(loadBrowserRuntime)

export const Root = ({ children }: { children: React.ReactNode }) => (
  <EffectQuery.Provider enabled={hydrated}>{children}</EffectQuery.Provider>
)

export const User = () => {
  const query = EffectQuery.useEffectQuery(
    getUserQuery.options({ path: { id: "u-1" } }),
  )

  return <pre>{JSON.stringify(query.data)}</pre>
}
```

应用负责创建与释放 runtime。Provider 只控制 runtime 是否可用；disabled 或缺失时 `useEffectQuery` 使用 TanStack `skipToken`。`useRunner` 在 Provider 外只可执行不需要业务环境的 Effect，并回退到 `Runtime.defaultRuntime`。

TanStack Start 中可用 `useHydrated()` 控制 `enabled`，并通过 `createClientOnlyFn` 动态加载浏览器 runtime；包本身不依赖 TanStack Start。

Effect 的单一业务失败保持原始错误，defect、中断和组合 Cause 转为 `QueryDefect`。第一阶段不提供 `useEffectMutation`，也不复刻 `initialData` 的 defined-result overload。
