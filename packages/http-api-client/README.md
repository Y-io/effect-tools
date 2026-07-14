# @pkg/http-api-client

为 Effect `HttpApiClient` 提供请求与响应 provider，并通过独立子路径提供 TanStack React Query 适配。

提供三个用于定义 `HttpApiClient` 请求与响应处理的工具：

```ts
makeRequestProvider
makeHeadersProvider
makeResponseProvider
```

它们不创建或封装 `HttpClient`。调用方直接使用 `@effect/platform` 组合具体 client，Effect 会自动推断每个提供者引入的 error 与 context。

## 组合示例

```ts
import {
  HttpApiClient,
  HttpClient,
  HttpClientRequest,
} from "@effect/platform"
import { Context, Effect } from "effect"
import {
  makeHeadersProvider,
  makeRequestProvider,
  makeResponseProvider,
} from "@pkg/http-api-client"
import { Api } from "./Api.js"

class BaseUrl extends Context.Tag("app/BaseUrl")<
  BaseUrl,
  { readonly get: Effect.Effect<string> }
>() {}

class Session extends Context.Tag("app/Session")<
  Session,
  {
    readonly token: Effect.Effect<string>
    readonly locale: Effect.Effect<string>
    readonly updateToken: (token: string) => Effect.Effect<void>
  }
>() {}

const withBaseUrl = makeRequestProvider((request) =>
  Effect.gen(function* () {
    const baseUrl = yield* BaseUrl
    return request.pipe(HttpClientRequest.prependUrl(yield* baseUrl.get))
  }),
)

const withSessionHeaders = makeHeadersProvider(() =>
  Effect.gen(function* () {
    const session = yield* Session
    return {
      authorization: `Bearer ${yield* session.token}`,
      "accept-language": yield* session.locale,
    }
  }),
)

const captureToken = makeResponseProvider((response) =>
  Effect.gen(function* () {
    const token = response.headers["x-token"]
    if (token !== undefined) {
      const session = yield* Session
      yield* session.updateToken(token)
    }
  }),
)

const makeClient = Effect.gen(function* () {
  const baseClient = yield* HttpClient.HttpClient
  const httpClient = baseClient.pipe(
    HttpClient.mapRequestEffect(withBaseUrl),
    HttpClient.mapRequestEffect(withSessionHeaders),
    HttpClient.tap(captureToken),
  )

  return yield* HttpApiClient.makeWith(Api, { httpClient })
})
```

请求提供者按 `pipe` 中的声明顺序执行。后一个请求提供者会收到前一个请求提供者返回的完整 `HttpClientRequest`，因此依赖最终 URL 或 headers 的签名提供者应放在相关变换之后。

响应提供者在收到原始 `HttpClientResponse` 后执行。若需要重试整个 endpoint 并重新读取动态 Service，调用方对 endpoint Effect 使用 `Effect.retry`。

## React Query

React 应用从 `@pkg/http-api-client/react` 导入 Query API；根入口不会加载 React 适配层。

```ts
import {
  makeEffectMutation,
  makeEffectQuery,
  makeEffectReactRuntime,
} from "@pkg/http-api-client/react"
```

完整用法见 [React Query 适配](./docs/react-query.md)。
