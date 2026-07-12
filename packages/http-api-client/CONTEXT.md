# HttpApiClient

为基于 `HttpApi` 生成的类型化客户端组合 Runtime 级请求变换与原始响应观察，同时保持具体业务协议与状态的归属边界。

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
