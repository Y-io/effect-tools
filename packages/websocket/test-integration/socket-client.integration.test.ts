import { describe, expect, test } from "bun:test"
import * as Socket from "@effect/platform/Socket"
import * as BunSocket from "@effect/platform-bun/BunSocket"
import { Data, Deferred, Effect, Option, Schema, Stream } from "effect"
import type { Scope } from "effect"
import { defineProtocol, defineProtocolCatalog, makeSocketClient } from "../src/index"

/**
 * 真实网络测试默认跳过，避免公共服务或 CI 网络波动影响单元测试。
 * 使用 `bun run test:integration` 显式启用，服务会原样 echo 客户端发送的文本帧。
 */
const publicEchoUrl = "wss://ws.postman-echo.com/raw"
const integrationTest = process.env.WEBSOCKET_INTEGRATION === "1" ? test : test.skip

class IntegrationTimeout extends Data.TaggedError("IntegrationTimeout")<{
  readonly message: string
}> {}

const catalog = defineProtocolCatalog({
  updates: defineProtocol({
    schema: Schema.Struct({
      type: Schema.Literal("subscribe"),
      identity: Schema.String,
      value: Schema.Number,
    }),
    subscriptionSchema: Schema.Struct({
      identity: Schema.String,
      value: Schema.Number,
    }),
    match: (parsed: unknown, identity: string) =>
      typeof parsed === "object" &&
      parsed !== null &&
      "identity" in parsed &&
      parsed.identity === identity,
    subscription: ({ identity, value }) => ({
      identity,
      // Echo 返回该控制消息，用同一条真实 frame 验证 parser、match、Schema 和 Stream。
      subscribe: () => JSON.stringify({ type: "subscribe", identity, value }),
    }),
  }),
})

const subscriptionParams = (identity: string, value: number) => ({ identity, value })

const withPublicClient = <A, E>(
  use: (
    client: Effect.Effect.Success<ReturnType<typeof makeSocketClient<typeof catalog>>>,
  ) => Effect.Effect<A, E, Scope.Scope>,
) =>
  // 每个用例使用独立 Socket Client Scope，确保公开连接在断言结束后关闭。
  Effect.scoped(
    Effect.gen(function* () {
      const socket = yield* Socket.makeWebSocket(publicEchoUrl, {
        openTimeout: "10 seconds",
      })
      const client = yield* makeSocketClient({ catalog, socket, parser: JSON.parse })
      return yield* use(client)
    }),
  ).pipe(Effect.provide(BunSocket.layerWebSocketConstructor))

describe("Socket Client 公开 WebSocket 集成", () => {
  /** 验证一条消息从真实 TLS WebSocket 到业务 Stream 的完整正向路径。 */
  integrationTest(
    "真实建连后将 echoed subscribe 匹配、解码并送入数据流",
    async () => {
      const result = await Effect.runPromise(
        withPublicClient((client) =>
          client.updates.stream(subscriptionParams("integration:single", 101)).pipe(
            Stream.runHead,
            Effect.timeoutFail({
              duration: "15 seconds",
              onTimeout: () => new IntegrationTimeout({ message: "等待公开 WebSocket echo 超时" }),
            }),
          ),
        ),
      )

      expect(result).toEqual(
        Option.some({ type: "subscribe", identity: "integration:single", value: 101 }),
      )
    },
    20_000,
  )

  /** 并发建立两个订阅，验证 echoed frame 只进入 identity 对应的数据流。 */
  integrationTest(
    "两个全局唯一 identity 只接收各自匹配的 echoed 消息",
    async () => {
      const [first, second] = await Effect.runPromise(
        withPublicClient((client) =>
          Effect.all(
            [
              Stream.runHead(client.updates.stream(subscriptionParams("integration:first", 1))),
              Stream.runHead(client.updates.stream(subscriptionParams("integration:second", 2))),
            ],
            { concurrency: "unbounded" },
          ).pipe(
            Effect.timeoutFail({
              duration: "15 seconds",
              onTimeout: () =>
                new IntegrationTimeout({ message: "等待两个公开 WebSocket echo 超时" }),
            }),
          ),
        ),
      )

      expect(first).toEqual(
        Option.some({ type: "subscribe", identity: "integration:first", value: 1 }),
      )
      expect(second).toEqual(
        Option.some({ type: "subscribe", identity: "integration:second", value: 2 }),
      )
    },
    20_000,
  )

  /** 首个消费者保持活跃；第二个消费者加入后不得收到已经发布的 echo。 */
  integrationTest(
    "相同 identity 的后加入消费者不会收到已经 echo 的历史值",
    async () => {
      const result = await Effect.runPromise(
        withPublicClient((client) =>
          Effect.gen(function* () {
            const received = yield* Deferred.make<void>()
            yield* Stream.runForEach(
              client.updates.stream(subscriptionParams("integration:shared", 1)),
              () => Deferred.succeed(received, undefined),
            ).pipe(Effect.forkScoped)
            yield* Deferred.await(received)

            return yield* client.updates
              .stream(subscriptionParams("integration:shared", 1))
              .pipe(Stream.timeout("2 seconds"), Stream.runHead)
          }),
        ),
      )

      expect(result).toEqual(Option.none())
    },
    20_000,
  )
})
