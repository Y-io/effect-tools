# Result Provider 调查结论

Schema 解码后的通用结果转换已通过 throwaway 原型验证，但不纳入首版。

- 具体 `HttpApi` 的 `ApiResult<User>` 可以映射为 `Effect<User, ApiResultError | HttpApiClientError, never>`。
- `withResponse: true` 可以保留为 `[User, HttpClientResponse]`，但必须从 `HttpApi` 的 group/endpoint 类型映射；对生成 client 做普通递归函数映射会破坏该泛型。
- 公共协议需要 Effect `TypeLambda` / `Kind`；具体 provider 的 HKT 实现和 client 重标注各需要受控断言，TypeScript 无法从函数体证明声明正确。
- `HttpApiClient.transformResponse` 不允许增加 Effect context，因此该扩展不能自然引入新的 `R`。
- annotation、反射与 runtime proxy 对已验证方案并非必要。

下一阶段只有在确认 Schema 解码后自动改变 endpoint success/error 类型仍是必要能力时，才应重新评估这项设计。
