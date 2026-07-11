import { describe, expect, test } from "bun:test"
import * as Socket from "@effect/platform/Socket"
import {
  Deferred,
  Effect,
  Exit,
  Fiber,
  Option,
  Schema,
  Scope,
  Stream,
  TestClock,
  TestContext,
} from "effect"
import { defineProtocol, defineProtocolCatalog, makeSocketClient } from "../src/index"
import { makeControllableSocket } from "./support/controllable-websocket-connection"

const catalog = defineProtocolCatalog({
  prices: defineProtocol({
    schema: Schema.Struct({
      type: Schema.Literal("price"),
      symbol: Schema.String,
      value: Schema.Number,
    }),
    match: (parsed: unknown, identity: string) =>
      typeof parsed === "object" &&
      parsed !== null &&
      "symbol" in parsed &&
      parsed.symbol === identity,
    subscription: (symbol: string) => ({
      identity: symbol,
      subscribe: () => `subscribe:${symbol}`,
      unsubscribe: () => `unsubscribe:${symbol}`,
    }),
  }),
})

describe("Socket Client", () => {
  test("生成类型安全的业务 Stream，并隔离 parser 与 Schema 失败", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const control = yield* makeControllableSocket()
          yield* control.open
          const client = yield* makeSocketClient({
            catalog,
            socket: control.socket,
            parser: JSON.parse,
          })
          const consumerScope = yield* Scope.make()
          const message = yield* Deferred.make<{
            readonly type: "price"
            readonly symbol: string
            readonly value: number
          }>()

          const consumer = yield* Stream.runForEach(client.prices.stream("BTC"), (value) =>
            Deferred.succeed(message, value),
          ).pipe(Effect.forkIn(consumerScope))

          expect(yield* control.takeSent).toBe("subscribe:BTC")

          yield* control.emitFrame("not-json")
          yield* control.emitFrame(JSON.stringify({ symbol: "ETH", value: 1 }))
          yield* control.emitFrame(JSON.stringify({ type: "price", symbol: "BTC", value: "bad" }))
          yield* control.emitFrame(JSON.stringify({ type: "price", symbol: "BTC", value: 101 }))

          expect(yield* Deferred.await(message)).toEqual({
            type: "price",
            symbol: "BTC",
            value: 101,
          })

          yield* Fiber.interrupt(consumer)
          expect(yield* control.takeSent).toBe("unsubscribe:BTC")
          yield* Scope.close(consumerScope, Exit.void)

          const verifyTypes = () => {
            // @ts-expect-error stream 参数来自 subscription factory
            void client.prices.stream(42)
          }
          expect(verifyTypes).toBeTypeOf("function")
        }),
      ),
    )
  })

  test("断线三秒后只从当前活跃订阅重建远端状态", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const control = yield* makeControllableSocket()
          yield* control.open
          const client = yield* makeSocketClient({
            catalog,
            socket: control.socket,
            parser: JSON.parse,
          })
          const consumer = yield* Stream.runDrain(client.prices.stream("BTC")).pipe(
            Effect.forkScoped,
          )

          expect(yield* control.takeSent).toBe("subscribe:BTC")
          yield* control.disconnect(1006, "lost")
          yield* control.runReleased
          yield* TestClock.sleeps().pipe(
            Effect.filterOrFail((sleeps) => sleeps.length === 1),
            Effect.eventually,
          )

          yield* TestClock.adjust("2999 millis")
          expect(yield* control.pollSent).toEqual(Option.none())

          yield* TestClock.adjust("1 millis")
          const restored = yield* control.pollSent.pipe(
            Effect.filterOrFail(Option.isSome),
            Effect.eventually,
          )
          expect(restored.value).toBe("subscribe:BTC")

          yield* Fiber.interrupt(consumer)
        }),
      ).pipe(Effect.provide(TestContext.TestContext)),
    )
  })

  test("控制消息发送失败会关闭当前连接并进入相同重连路径", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const control = yield* makeControllableSocket()
          yield* control.open
          const client = yield* makeSocketClient({
            catalog,
            socket: control.socket,
            parser: JSON.parse,
          })
          yield* control.failNextSend(
            new Socket.SocketGenericError({
              reason: "Write",
              cause: "failed",
            }),
          )

          const consumer = yield* Stream.runDrain(client.prices.stream("BTC")).pipe(
            Effect.forkScoped,
          )
          yield* control.closeCount.pipe(
            Effect.filterOrFail((count) => count === 1),
            Effect.eventually,
          )
          yield* TestClock.sleeps().pipe(
            Effect.filterOrFail((sleeps) => sleeps.length === 1),
            Effect.eventually,
          )

          yield* TestClock.adjust("3 seconds")
          const restored = yield* control.pollSent.pipe(
            Effect.filterOrFail(Option.isSome),
            Effect.eventually,
          )
          expect(restored.value).toBe("subscribe:BTC")
          yield* Fiber.interrupt(consumer)
        }),
      ).pipe(Effect.provide(TestContext.TestContext)),
    )
  })

  test("断线期间释放的订阅不会在新连接回放旧控制消息", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const control = yield* makeControllableSocket()
          yield* control.open
          const client = yield* makeSocketClient({
            catalog,
            socket: control.socket,
            parser: JSON.parse,
          })
          const consumer = yield* Stream.runDrain(client.prices.stream("BTC")).pipe(
            Effect.forkScoped,
          )

          expect(yield* control.takeSent).toBe("subscribe:BTC")
          yield* control.disconnect(1006, "lost")
          yield* control.runReleased
          yield* TestClock.sleeps().pipe(
            Effect.filterOrFail((sleeps) => sleeps.length === 1),
            Effect.eventually,
          )
          yield* Fiber.interrupt(consumer)

          yield* TestClock.adjust("3 seconds")
          yield* control.runCount.pipe(
            Effect.filterOrFail((count) => count === 2),
            Effect.eventually,
          )
          expect(yield* control.pollSent).toEqual(Option.none())
        }),
      ).pipe(Effect.provide(TestContext.TestContext)),
    )
  })

  test("Socket Client Scope 结束会关闭连接并停止重连", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const control = yield* makeControllableSocket()
          yield* control.open
          const clientScope = yield* Scope.make()
          const client = yield* makeSocketClient({
            catalog,
            socket: control.socket,
            parser: JSON.parse,
          }).pipe(Scope.extend(clientScope))
          yield* Stream.runDrain(client.prices.stream("BTC")).pipe(Effect.forkIn(clientScope))
          expect(yield* control.takeSent).toBe("subscribe:BTC")

          yield* Scope.close(clientScope, Exit.void)
          expect(yield* control.closeCount).toBe(1)

          yield* TestClock.adjust("30 seconds")
          expect(yield* control.runCount).toBe(1)
        }),
      ).pipe(Effect.provide(TestContext.TestContext)),
    )
  })
})
