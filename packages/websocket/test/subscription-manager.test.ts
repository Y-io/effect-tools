import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Exit, Fiber, FiberStatus, Option, Ref, Schema, Scope, Stream } from "effect"
import {
  defineProtocol,
  makeSubscriptionManager,
  type SubscriptionControl,
} from "../src/index"

describe("订阅管理器", () => {
  test("同一订阅实例的多个消费者共享消息与远端订阅", async () => {
    const controls: Array<SubscriptionControl> = []
    const protocol = defineProtocol({
      schema: Schema.Struct({ id: Schema.String, value: Schema.Number }),
      match: (_parsed: unknown, identity: string) => identity === "resource-1",
      subscription: (id: string) => ({
        identity: id,
        subscribe: { type: "subscribe", id },
        unsubscribe: { type: "unsubscribe", id },
      }),
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const manager = yield* makeSubscriptionManager((control) =>
          Effect.sync(() => controls.push(control)),
        )
        const firstScope = yield* Scope.make()
        const secondScope = yield* Scope.make()
        const firstMessage = yield* Deferred.make<unknown>()
        const secondMessage = yield* Deferred.make<unknown>()
        const stream = manager.stream("resourceUpdated", protocol, protocol.subscription("resource-1"))

        const first = yield* Stream.runForEach(stream, (message) => Deferred.succeed(firstMessage, message)).pipe(
          Effect.forkIn(firstScope),
        )
        yield* Fiber.status(first).pipe(
          Effect.filterOrFail(FiberStatus.isSuspended),
          Effect.eventually,
        )
        const second = yield* Stream.runForEach(stream, (message) => Deferred.succeed(secondMessage, message)).pipe(
          Effect.forkIn(secondScope),
        )
        yield* Fiber.status(second).pipe(
          Effect.filterOrFail(FiberStatus.isSuspended),
          Effect.eventually,
        )

        expect(controls).toEqual([{ type: "subscribe", id: "resource-1" }])

        yield* manager.publish("resourceUpdated", "resource-1", { id: "resource-1", value: 1 })

        expect(yield* Deferred.await(firstMessage)).toEqual({ id: "resource-1", value: 1 })
        expect(yield* Deferred.await(secondMessage)).toEqual({ id: "resource-1", value: 1 })

        yield* Scope.close(firstScope, Exit.void)
        expect(controls).toEqual([{ type: "subscribe", id: "resource-1" }])

        yield* Scope.close(secondScope, Exit.void)
        expect(controls).toEqual([
          { type: "subscribe", id: "resource-1" },
          { type: "unsubscribe", id: "resource-1" },
        ])
      }),
    )
  })

  test("同一协议下不同 identity 的消息相互隔离", async () => {
    const protocol = defineProtocol({
      schema: Schema.Struct({ id: Schema.String, value: Schema.Number }),
      match: (parsed: unknown, identity: string) =>
        typeof parsed === "object" && parsed !== null && "id" in parsed && parsed.id === identity,
      subscription: (id: string) => ({ identity: id }),
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const manager = yield* makeSubscriptionManager(() => Effect.void)
        const firstScope = yield* Scope.make()
        const secondScope = yield* Scope.make()
        const firstMessage = yield* Deferred.make<unknown>()
        const secondMessage = yield* Deferred.make<unknown>()

        const first = yield* Stream.runForEach(
          manager.stream("resourceUpdated", protocol, protocol.subscription("resource-1")),
          (message) => Deferred.succeed(firstMessage, message),
        ).pipe(Effect.forkIn(firstScope))
        const second = yield* Stream.runForEach(
          manager.stream("resourceUpdated", protocol, protocol.subscription("resource-2")),
          (message) => Deferred.succeed(secondMessage, message),
        ).pipe(Effect.forkIn(secondScope))
        yield* Effect.all([Fiber.status(first), Fiber.status(second)], {
          concurrency: "unbounded",
        }).pipe(
          Effect.filterOrFail((statuses) => statuses.every(FiberStatus.isSuspended)),
          Effect.eventually,
        )

        const resource1 = { id: "resource-1", value: 1 }
        yield* manager.publish("resourceUpdated", "resource-1", resource1)
        expect(yield* Deferred.await(firstMessage)).toEqual(resource1)
        expect(Option.isNone(yield* Deferred.poll(secondMessage))).toBe(true)

        const resource2 = { id: "resource-2", value: 2 }
        yield* manager.publish("resourceUpdated", "resource-2", resource2)
        expect(yield* Deferred.await(secondMessage)).toEqual(resource2)

        yield* Scope.close(firstScope, Exit.void)
        yield* Scope.close(secondScope, Exit.void)
      }),
    )
  })

  test("慢消费者只保留最新待处理值且新消费者不接收历史值", async () => {
    const protocol = defineProtocol({
      schema: Schema.Number,
      match: (_parsed: unknown, identity: string) => identity === "prices",
      subscription: () => ({ identity: "prices" }),
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const manager = yield* makeSubscriptionManager(() => Effect.void)
        const firstScope = yield* Scope.make()
        const secondScope = yield* Scope.make()
        const firstStarted = yield* Deferred.make<void>()
        const resumeFirst = yield* Deferred.make<void>()
        const firstValues = yield* Ref.make<ReadonlyArray<number>>([])
        const firstReceivedFour = yield* Deferred.make<void>()
        const secondValue = yield* Deferred.make<number>()
        const stream = manager.stream("priceUpdated", protocol, protocol.subscription())

        const first = yield* Stream.runForEach(stream, (value) =>
          Effect.gen(function* () {
            yield* Ref.update(firstValues, (values) => [...values, value])
            if (value === 1) {
              yield* Deferred.succeed(firstStarted, undefined)
              yield* Deferred.await(resumeFirst)
            }
            if (value === 4) yield* Deferred.succeed(firstReceivedFour, undefined)
          }),
        ).pipe(Effect.forkIn(firstScope))
        yield* Fiber.status(first).pipe(
          Effect.filterOrFail(FiberStatus.isSuspended),
          Effect.eventually,
        )

        yield* manager.publish("priceUpdated", "prices", 1)
        yield* Deferred.await(firstStarted)
        yield* manager.publish("priceUpdated", "prices", 2)
        yield* manager.publish("priceUpdated", "prices", 3)
        yield* Deferred.succeed(resumeFirst, undefined)
        const values = yield* Ref.get(firstValues).pipe(
          Effect.filterOrFail((current) => current.length === 2),
          Effect.eventually,
        )
        expect(values).toEqual([1, 3])

        const second = yield* Stream.runForEach(stream, (value) => Deferred.succeed(secondValue, value)).pipe(
          Effect.forkIn(secondScope),
        )
        yield* Fiber.status(second).pipe(
          Effect.filterOrFail(FiberStatus.isSuspended),
          Effect.eventually,
        )
        expect(Option.isNone(yield* Deferred.poll(secondValue))).toBe(true)

        yield* manager.publish("priceUpdated", "prices", 4)
        yield* Deferred.await(firstReceivedFour)
        expect(yield* Deferred.await(secondValue)).toBe(4)

        yield* Scope.close(firstScope, Exit.void)
        yield* Scope.close(secondScope, Exit.void)
      }),
    )
  })

  test("消费失败与 Fiber 中断都会自动释放订阅引用", async () => {
    const controls: Array<SubscriptionControl> = []
    const protocol = defineProtocol({
      schema: Schema.Number,
      match: (_parsed: unknown, identity: string) => identity === "prices",
      subscription: () => ({
        identity: "prices",
        subscribe: "subscribe:prices",
        unsubscribe: "unsubscribe:prices",
      }),
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const manager = yield* makeSubscriptionManager((control) =>
          Effect.sync(() => controls.push(control)),
        )
        const stream = manager.stream("priceUpdated", protocol, protocol.subscription())

        const failureScope = yield* Scope.make()
        const failingConsumer = yield* stream.pipe(
          Stream.take(1),
          Stream.concat(Stream.fail("consumer failed")),
          Stream.runDrain,
          Effect.forkIn(failureScope),
        )
        yield* Fiber.status(failingConsumer).pipe(
          Effect.filterOrFail(FiberStatus.isSuspended),
          Effect.eventually,
        )
        yield* manager.publish("priceUpdated", "prices", 1)
        expect(yield* Fiber.await(failingConsumer)).toEqual(Exit.fail("consumer failed"))
        expect(controls).toEqual(["subscribe:prices", "unsubscribe:prices"])

        const interruptionScope = yield* Scope.make()
        const interruptedConsumer = yield* Stream.runDrain(stream).pipe(Effect.forkIn(interruptionScope))
        yield* Fiber.status(interruptedConsumer).pipe(
          Effect.filterOrFail(FiberStatus.isSuspended),
          Effect.eventually,
        )
        yield* Fiber.interrupt(interruptedConsumer)
        expect(controls).toEqual([
          "subscribe:prices",
          "unsubscribe:prices",
          "subscribe:prices",
          "unsubscribe:prices",
        ])

        yield* Scope.close(failureScope, Exit.void)
        yield* Scope.close(interruptionScope, Exit.void)
      }),
    )
  })

  test("无控制消息的被动订阅仍具有完整的 Scope 与消息流语义", async () => {
    const controls: Array<SubscriptionControl> = []
    const protocol = defineProtocol({
      schema: Schema.Number,
      match: (_parsed: unknown, identity: string) => identity === "market-price",
      subscription: () => ({ identity: "market-price" }),
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const manager = yield* makeSubscriptionManager((control) =>
          Effect.sync(() => controls.push(control)),
        )
        const stream = manager.stream("priceUpdated", protocol, protocol.subscription())

        const firstScope = yield* Scope.make()
        const firstMessage = yield* Deferred.make<number>()
        const first = yield* Stream.runForEach(stream, (message) =>
          Deferred.succeed(firstMessage, message),
        ).pipe(Effect.forkIn(firstScope))
        yield* Fiber.status(first).pipe(
          Effect.filterOrFail(FiberStatus.isSuspended),
          Effect.eventually,
        )
        yield* manager.publish("priceUpdated", "market-price", 101)
        expect(yield* Deferred.await(firstMessage)).toBe(101)
        yield* Scope.close(firstScope, Exit.void)

        const secondScope = yield* Scope.make()
        const secondMessage = yield* Deferred.make<number>()
        const second = yield* Stream.runForEach(stream, (message) =>
          Deferred.succeed(secondMessage, message),
        ).pipe(Effect.forkIn(secondScope))
        yield* Fiber.status(second).pipe(
          Effect.filterOrFail(FiberStatus.isSuspended),
          Effect.eventually,
        )
        yield* manager.publish("priceUpdated", "market-price", 102)
        expect(yield* Deferred.await(secondMessage)).toBe(102)
        yield* Scope.close(secondScope, Exit.void)

        expect(controls).toEqual([])
      }),
    )
  })
})
