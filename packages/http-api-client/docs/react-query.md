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

## Mutation descriptor

```tsx
import { makeEffectMutationOptions } from "@pkg/http-api-client/react-query"

export const updateUserMutation = makeEffectMutationOptions(
  ApiClient,
  (client) => client.users.update,
  "PATCH:users.update",
)

export const UpdateUser = () => {
  const mutation = EffectQuery.useEffectMutation({
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

应用负责创建与释放 runtime。Provider 只控制 runtime 是否可用；disabled 或缺失时 `useEffectQuery` 使用 TanStack `skipToken`。`useEffectMutation` 仍返回原生 mutation result，但提交需要业务 Service 的 mutation 时会通过默认 runtime 失败为 `EffectDefect`。`useRunner` 在 Provider 外只可执行不需要业务环境的 Effect，并回退到 `Runtime.defaultRuntime`。

Effect 的单一业务失败保持原始错误，defect、中断和组合 Cause 转为 `EffectDefect`。当前不复刻 Query `initialData` 的 defined-result overload。
