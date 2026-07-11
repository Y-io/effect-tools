import { describe, expect, test } from "bun:test"
import * as Socket from "@effect/platform/Socket"
import {
  Deferred,
  Effect,
  Exit,
  Fiber,
  Option,
  Ref,
  Schema,
  Scope,
  Stream,
  TestClock,
  TestContext,
} from "effect"
import { defineProtocol, defineProtocolCatalog, makeSocketClient } from "../src/index"
import { makeControllableSocket } from "./support/controllable-websocket-connection"

const catalog = defineProtocolCatalog({
  updates: defineProtocol({
    schema: Schema.Struct({
      type: Schema.Literal("update"),
      resourceId: Schema.String,
      value: Schema.Number,
    }),
    match: (parsed: unknown, identity: string) =>
      typeof parsed === "object" &&
      parsed !== null &&
      "resourceId" in parsed &&
      parsed.resourceId === identity,
    subscription: (resourceId: string) => ({
      identity: resourceId,
      subscribe: () => `subscribe:${resourceId}`,
      unsubscribe: () => `unsubscribe:${resourceId}`,
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
            readonly type: "update"
            readonly resourceId: string
            readonly value: number
          }>()

          const consumer = yield* Stream.runForEach(client.updates.stream("resource-1"), (value) =>
            Deferred.succeed(message, value),
          ).pipe(Effect.forkIn(consumerScope))

          expect(yield* control.takeSent).toBe("subscribe:resource-1")

          yield* control.emitFrame("not-json")
          yield* control.emitFrame(JSON.stringify({ resourceId: "resource-2", value: 1 }))
          yield* control.emitFrame(
            JSON.stringify({ type: "update", resourceId: "resource-1", value: "bad" }),
          )
          yield* control.emitFrame(
            JSON.stringify({ type: "update", resourceId: "resource-1", value: 101 }),
          )

          expect(yield* Deferred.await(message)).toEqual({
            type: "update",
            resourceId: "resource-1",
            value: 101,
          })

          yield* Fiber.interrupt(consumer)
          expect(yield* control.takeSent).toBe("unsubscribe:resource-1")
          yield* Scope.close(consumerScope, Exit.void)

          const verifyTypes = () => {
            // @ts-expect-error stream 参数来自 subscription factory
            void client.updates.stream(42)
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
          const consumer = yield* Stream.runDrain(client.updates.stream("resource-1")).pipe(
            Effect.forkScoped,
          )

          expect(yield* control.takeSent).toBe("subscribe:resource-1")
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
          expect(restored.value).toBe("subscribe:resource-1")

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

          const consumer = yield* Stream.runDrain(client.updates.stream("resource-1")).pipe(
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
          expect(restored.value).toBe("subscribe:resource-1")
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
          const consumer = yield* Stream.runDrain(client.updates.stream("resource-1")).pipe(
            Effect.forkScoped,
          )

          expect(yield* control.takeSent).toBe("subscribe:resource-1")
          yield* control.disconnect(1006, "lost")
          yield* control.runReleased
          yield* TestClock.sleeps().pipe(
            Effect.filterOrFail((sleeps) => sleeps.length === 1),
            Effect.eventually,
          )
          yield* Fiber.interrupt(consumer)

          yield* TestClock.adjust("3 seconds")
          yield* control.readyCount.pipe(
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
          yield* Stream.runDrain(client.updates.stream("resource-1")).pipe(
            Effect.forkIn(clientScope),
          )
          expect(yield* control.takeSent).toBe("subscribe:resource-1")

          yield* Scope.close(clientScope, Exit.void)
          expect(yield* control.closeCount).toBe(1)

          yield* TestClock.adjust("30 seconds")
          expect(yield* control.runCount).toBe(1)
        }),
      ).pipe(Effect.provide(TestContext.TestContext)),
    )
  })

  test("相同 identity 的消费者共享远端订阅，不同 identity 相互隔离", async () => {
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
          const firstScope = yield* Scope.make()
          const secondScope = yield* Scope.make()
          const secondResourceScope = yield* Scope.make()
          const first = yield* Deferred.make<number>()
          const second = yield* Deferred.make<number>()
          const secondResource = yield* Deferred.make<number>()

          yield* Stream.runForEach(client.updates.stream("resource-1"), (message) =>
            Deferred.succeed(first, message.value),
          ).pipe(Effect.forkIn(firstScope))
          yield* Stream.runForEach(client.updates.stream("resource-1"), (message) =>
            Deferred.succeed(second, message.value),
          ).pipe(Effect.forkIn(secondScope))
          yield* Stream.runForEach(client.updates.stream("resource-2"), (message) =>
            Deferred.succeed(secondResource, message.value),
          ).pipe(Effect.forkIn(secondResourceScope))

          expect(yield* control.takeSent).toBe("subscribe:resource-1")
          expect(yield* control.takeSent).toBe("subscribe:resource-2")
          yield* control.emitFrame(
            JSON.stringify({ type: "update", resourceId: "resource-1", value: 101 }),
          )
          expect(yield* Deferred.await(first)).toBe(101)
          expect(yield* Deferred.await(second)).toBe(101)
          expect(Option.isNone(yield* Deferred.poll(secondResource))).toBe(true)

          yield* Scope.close(firstScope, Exit.void)
          expect(Option.isNone(yield* control.pollSent)).toBe(true)
          yield* Scope.close(secondScope, Exit.void)
          expect(yield* control.takeSent).toBe("unsubscribe:resource-1")
          yield* Scope.close(secondResourceScope, Exit.void)
          expect(yield* control.takeSent).toBe("unsubscribe:resource-2")
        }),
      ),
    )
  })

  test("重叠粗匹配按订阅实例创建顺序只发布给首个实例", async () => {
    const overlappingCatalog = defineProtocolCatalog({
      events: defineProtocol({
        schema: Schema.Struct({
          identities: Schema.Array(Schema.String),
          value: Schema.Number,
        }),
        match: (parsed: unknown, identity: string) =>
          typeof parsed === "object" &&
          parsed !== null &&
          "identities" in parsed &&
          Array.isArray(parsed.identities) &&
          parsed.identities.includes(identity),
        subscription: (identity: string) => ({ identity }),
      }),
    })

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const control = yield* makeControllableSocket()
          yield* control.open
          const client = yield* makeSocketClient({
            catalog: overlappingCatalog,
            socket: control.socket,
            parser: JSON.parse,
          })
          const first = yield* Deferred.make<number>()
          const second = yield* Deferred.make<number>()
          yield* Stream.runForEach(client.events.stream("first"), (message) =>
            Deferred.succeed(first, message.value),
          ).pipe(Effect.forkScoped)
          yield* Stream.runForEach(client.events.stream("second"), (message) =>
            Deferred.succeed(second, message.value),
          ).pipe(Effect.forkScoped)
          yield* Effect.yieldNow()

          yield* control.emitFrame(JSON.stringify({ identities: ["first", "second"], value: 1 }))
          expect(yield* Deferred.await(first)).toBe(1)
          expect(Option.isNone(yield* Deferred.poll(second))).toBe(true)
        }),
      ),
    )
  })

  test("首个消费者在 subscribe 发送前已接入即时响应", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const control = yield* makeControllableSocket()
          yield* control.open
          yield* control.replyToNextSend(
            JSON.stringify({ type: "update", resourceId: "resource-1", value: 101 }),
          )
          const client = yield* makeSocketClient({
            catalog,
            socket: control.socket,
            parser: JSON.parse,
          })

          expect(yield* Stream.runHead(client.updates.stream("resource-1"))).toEqual(
            Option.some({ type: "update", resourceId: "resource-1", value: 101 }),
          )
          expect(yield* control.takeSent).toBe("subscribe:resource-1")
          expect(yield* control.takeSent).toBe("unsubscribe:resource-1")
        }),
      ),
    )
  })

  test("被动订阅保持 latest-value 且新消费者不接收历史值", async () => {
    const matched: Array<unknown> = []
    const passiveCatalog = defineProtocolCatalog({
      updates: defineProtocol({
        schema: Schema.Number,
        match: (parsed: unknown, identity: string) => {
          matched.push(parsed)
          return identity === "updates"
        },
        subscription: () => ({ identity: "updates" }),
      }),
    })

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const control = yield* makeControllableSocket()
          yield* control.open
          const client = yield* makeSocketClient({
            catalog: passiveCatalog,
            socket: control.socket,
            parser: JSON.parse,
          })
          const firstStarted = yield* Deferred.make<void>()
          const firstReady = yield* Deferred.make<void>()
          const resumeFirst = yield* Deferred.make<void>()
          const firstValues = yield* Ref.make<ReadonlyArray<number>>([])
          yield* control.readyCount.pipe(
            Effect.filterOrFail((count) => count === 1),
            Effect.eventually,
          )

          yield* Stream.runForEach(client.updates.stream(), (value) =>
            Effect.gen(function* () {
              if (value === 0) {
                yield* Deferred.succeed(firstReady, undefined)
                return
              }
              yield* Ref.update(firstValues, (values) => [...values, value])
              if (value === 1) {
                yield* Deferred.succeed(firstStarted, undefined)
                yield* Deferred.await(resumeFirst)
              }
            }),
          ).pipe(Effect.forkScoped)
          expect(Option.isNone(yield* control.pollSent)).toBe(true)

          yield* control
            .emitFrame("0")
            .pipe(
              Effect.zipRight(Deferred.poll(firstReady)),
              Effect.filterOrFail(Option.isSome),
              Effect.eventually,
            )
          yield* control.emitFrame("1")
          yield* Deferred.await(firstStarted)
          yield* control.emitFrame("2")
          yield* control.emitFrame("3")
          yield* Effect.sync(() => matched.includes(2) && matched.includes(3)).pipe(
            Effect.filterOrFail((received) => received),
            Effect.eventually,
          )
          yield* Deferred.succeed(resumeFirst, undefined)
          const values = yield* Ref.get(firstValues).pipe(
            Effect.filterOrFail((current) => current.length === 2),
            Effect.eventually,
          )
          expect(values).toEqual([1, 3])

          const historical = yield* client.updates
            .stream()
            .pipe(Stream.timeout("1 second"), Stream.runHead, Effect.fork)
          yield* TestClock.sleeps().pipe(
            Effect.filterOrFail((sleeps) => sleeps.length === 1),
            Effect.eventually,
          )
          yield* TestClock.adjust("1 second")
          expect(yield* Fiber.join(historical)).toEqual(Option.none())
        }),
      ).pipe(Effect.provide(TestContext.TestContext)),
    )
  })

  test("并发消费者只产生一对订阅控制消息", async () => {
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
          const scopes = yield* Effect.forEach(Array.from({ length: 20 }), () => Scope.make(), {
            concurrency: "unbounded",
          })
          const consumers = yield* Effect.forEach(
            scopes,
            (scope) =>
              Stream.runDrain(client.updates.stream("resource-1")).pipe(Effect.forkIn(scope)),
            { concurrency: "unbounded" },
          )

          expect(yield* control.takeSent).toBe("subscribe:resource-1")
          expect(Option.isNone(yield* control.pollSent)).toBe(true)
          yield* Effect.forEach(consumers, Fiber.interrupt, {
            concurrency: "unbounded",
            discard: true,
          })
          expect(yield* control.takeSent).toBe("unsubscribe:resource-1")
          expect(Option.isNone(yield* control.pollSent)).toBe(true)
        }),
      ),
    )
  })
})
