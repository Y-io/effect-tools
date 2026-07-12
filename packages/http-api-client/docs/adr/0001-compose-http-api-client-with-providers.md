# 使用 Provider 管线组合 HttpApiClient

`@pkg/http-api-client` 只提供 `makeRequestProvider`、基于 `HttpClientRequest.setHeaders` 的 `makeHeadersProvider` 与 `makeResponseProvider`。调用方使用 `HttpClient.mapRequestEffect`、`HttpClient.tap` 直接装饰具体 `HttpClient`，再交给官方 `HttpApiClient.makeWith`；具体 token、locale、uid、base URL、signature、重试、注册与冲突策略仍由调用方使用 Effect 和 `@effect/platform` 组合，避免公共包成为另一套 middleware 框架。

Schema 解码后的类型变换暂不纳入首版：原型证明通用 `resultProvider` 会要求 HKT、endpoint/group 类型重映射及无法由 TypeScript 验证的断言边界，这份复杂度尚未由当前范围支付。
