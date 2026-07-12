import { describe, expect, test } from "bun:test"
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform"
import { Context, Effect, Ref, Schema } from "effect"
import { make, makeHeadersProvider, makeRequestProvider, makeResponseProvider } from "../src/index"

class CurrentHeader extends Context.Tag("test/CurrentHeader")<CurrentHeader, string>() {}

describe("请求提供者", () => {
  test("Header 提供者使用 setHeaders 合并动态 headers", async () => {
    const provider = makeHeadersProvider((request) =>
      Effect.gen(function* () {
        const value = yield* CurrentHeader
        return {
          "x-current": `${value}:${request.method}`,
          "x-new": "new-value",
        }
      }),
    )

    const initial = HttpClientRequest.get("https://example.test").pipe(
      HttpClientRequest.setHeaders({
        "x-current": "old-value",
        "x-existing": "existing-value",
      }),
    )
    const request = await Effect.runPromise(
      provider(initial).pipe(Effect.provideService(CurrentHeader, "current-value")),
    )

    expect(request.headers).toMatchObject({
      "x-current": "current-value:GET",
      "x-existing": "existing-value",
      "x-new": "new-value",
    })
  })
})

describe("HttpApiClient", () => {
  test("按声明顺序组合请求提供者与响应提供者，并返回 Schema 解码结果", async () => {
    const events = Ref.unsafeMake<ReadonlyArray<string>>([])
    const appendEvent = (event: string) => Ref.update(events, (values) => [...values, event])
    const api = HttpApi.make("test-api").add(
      HttpApiGroup.make("test").add(
        HttpApiEndpoint.get("getValue", "/value").addSuccess(
          Schema.Struct({ value: Schema.String }),
        ),
      ),
    )
    const httpClient = HttpClient.make((request) =>
      Effect.gen(function* () {
        yield* appendEvent(`send:${request.headers["x-sequence"]}`)
        return HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify({ value: "decoded-value" }), {
            status: 200,
            headers: { "content-type": "application/json", "x-response": "raw-value" },
          }),
        )
      }),
    )
    const firstRequest = makeRequestProvider((request) =>
      appendEvent("request:first").pipe(
        Effect.as(
          request.pipe(
            HttpClientRequest.prependUrl("https://example.test"),
            HttpClientRequest.setHeader("x-sequence", "first"),
          ),
        ),
      ),
    )
    const secondRequest = makeRequestProvider((request) =>
      appendEvent("request:second").pipe(
        Effect.as(
          request.pipe(
            HttpClientRequest.setHeader("x-sequence", `${request.headers["x-sequence"]},second`),
          ),
        ),
      ),
    )
    const firstResponse = makeResponseProvider((response) =>
      appendEvent(`response:first:${response.headers["x-response"]}`),
    )
    const secondResponse = makeResponseProvider(() => appendEvent("response:second"))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* make(api, {
          requestProviders: [firstRequest, secondRequest],
          responseProviders: [firstResponse, secondResponse],
        })
        return yield* client.test.getValue({})
      }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient)),
    )

    expect(result).toEqual({ value: "decoded-value" })
    expect(Ref.get(events).pipe(Effect.runSync)).toEqual([
      "request:first",
      "request:second",
      "send:first,second",
      "response:first:raw-value",
      "response:second",
    ])
  })

  test("响应提供者在 Schema 解码失败前执行", async () => {
    const observed = Ref.unsafeMake(false)
    const api = HttpApi.make("decode-order").add(
      HttpApiGroup.make("test").add(
        HttpApiEndpoint.get("getValue", "/value").addSuccess(
          Schema.Struct({ value: Schema.String }),
        ),
      ),
    )
    const httpClient = HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify({ unexpected: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    )

    await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* make(api, {
          requestProviders: [
            makeRequestProvider((request) =>
              Effect.succeed(request.pipe(HttpClientRequest.prependUrl("https://example.test"))),
            ),
          ],
          responseProviders: [makeResponseProvider(() => Ref.set(observed, true))],
        })
        yield* client.test.getValue({})
      }).pipe(Effect.flip, Effect.provideService(HttpClient.HttpClient, httpClient)),
    )

    expect(Ref.get(observed).pipe(Effect.runSync)).toBe(true)
  })
})
