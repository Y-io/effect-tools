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

## Runtime 与 React

```tsx
import { makeEffectQueryRuntime } from "@pkg/http-api-client/react-query"

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

Effect 的单一业务失败保持原始错误，defect、中断和组合 Cause 转为 `QueryDefect`。当前不提供 `useEffectMutation`，也不复刻 `initialData` 的 defined-result overload。
