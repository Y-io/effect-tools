import { describe, expect, test } from "bun:test"
import {
  Deferred,
  Effect,
  Exit,
  Fiber,
  FiberStatus,
  Option,
  Ref,
  Schema,
  Scope,
  Stream,
} from "effect"
import { defineProtocol, makeSubscriptionManager, type SubscriptionControl } from "../src/index"

describe("订阅管理器", () => {
  /**
   * 测试将验证：
   *
   * 1. 首个消费者产生一次 subscribe。
   * 2. 相同协议键与 identity 的第二个消费者不重复 subscribe。
   * 3. 两个消费者接收同一条实时消息。
   * 4. 第一个消费者退出时不产生 unsubscribe。
   * 5. 最后一个消费者退出时只产生一次 unsubscribe。
   * 6. 只通过公开 API 与控制消息观察行为，不读取内部状态。
   */
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
        const stream = manager.stream(
          "resourceUpdated",
          protocol,
          protocol.subscription("resource-1"),
        )

        const first = yield* Stream.runForEach(stream, (message) =>
          Deferred.succeed(firstMessage, message),
        ).pipe(Effect.forkIn(firstScope))
        yield* Fiber.status(first).pipe(
          Effect.filterOrFail(FiberStatus.isSuspended),
          Effect.eventually,
        )
        const second = yield* Stream.runForEach(stream, (message) =>
          Deferred.succeed(secondMessage, message),
        ).pipe(Effect.forkIn(secondScope))
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

  /**
   * 测试将验证：
   *
   * 1. 同一协议下可以同时建立两个不同 identity 的订阅实例。
   * 2. 发给第一个 identity 的消息只由第一个消费者接收。
   * 3. 第二个消费者不会接收到第一个 identity 的消息。
   * 4. 发给第二个 identity 的消息由第二个消费者正确接收。
   */
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

  /**
   * 测试将验证：
   *
   * 1. 消费者处理首个值时可以继续发布后续值。
   * 2. 慢消费者只保留最新待处理值，观察到的序列为 [1, 3] 而不是 [1, 2, 3]。
   * 3. 后加入的消费者不会接收加入前的历史值。
   * 4. 新值发布后，先后加入的消费者都能接收该实时值。
   * 5. 所有行为仅通过共享消息流观察，不检查 PubSub 或其容量。
   */
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

        const second = yield* Stream.runForEach(stream, (value) =>
          Deferred.succeed(secondValue, value),
        ).pipe(Effect.forkIn(secondScope))
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

  /**
   * 测试将验证：
   *
   * 1. 下游消费失败会通过 Scope 自动释放订阅引用。
   * 2. 消费失败产生一对有序的 subscribe 与 unsubscribe。
   * 3. Fiber 中断也会通过 Scope 自动释放订阅引用。
   * 4. 中断产生另一对有序的 subscribe 与 unsubscribe。
   * 5. 测试不调用手动 release，也不读取内部引用计数。
   */
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
        const interruptedConsumer = yield* Stream.runDrain(stream).pipe(
          Effect.forkIn(interruptionScope),
        )
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

  /**
   * 测试将验证：
   *
   * 1. subscription factory 可以只提供 identity，不提供控制消息。
   * 2. 被动订阅的消费者仍能接收实时消息。
   * 3. 消费者退出后可用相同 identity 重新建立订阅实例。
   * 4. 重新建立的消费者仍能接收实时消息。
   * 5. 整个生命周期中 control writer 从未被调用。
   */
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

  /**
   * 测试将验证：
   *
   * 1. 并发启动多个相同订阅实例的消费者。
   * 2. 所有消费者就绪后只产生一次 subscribe。
   * 3. 并发中断所有消费者。
   * 4. 只有最后一个引用释放时产生一次 unsubscribe。
   * 5. 最终控制消息严格为 subscribe → unsubscribe，不存在重复或乱序。
   * 6. 测试不读取内部 Map、引用计数、锁或队列。
   */
  test("并发 acquire 与 release 只产生一对有序控制消息", async () => {
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
        const scopes = yield* Effect.forEach(Array.from({ length: 20 }), () => Scope.make(), {
          concurrency: "unbounded",
        })
        const consumers = yield* Effect.forEach(
          scopes,
          (scope) => Stream.runDrain(stream).pipe(Effect.forkIn(scope)),
          { concurrency: "unbounded" },
        )
        yield* Effect.forEach(consumers, Fiber.status, { concurrency: "unbounded" }).pipe(
          Effect.filterOrFail((statuses) => statuses.every(FiberStatus.isSuspended)),
          Effect.eventually,
        )

        expect(controls).toEqual(["subscribe:prices"])

        yield* Effect.forEach(consumers, Fiber.interrupt, {
          concurrency: "unbounded",
          discard: true,
        })
        expect(controls).toEqual(["subscribe:prices", "unsubscribe:prices"])

        yield* Effect.forEach(scopes, (scope) => Scope.close(scope, Exit.void), {
          concurrency: "unbounded",
          discard: true,
        })
      }),
    )
  })
})
