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
import { defineProtocol, makeSubscriptionManager, type SubscriptionManager } from "../src/index"
import { publishMatched } from "./support/subscription-manager"

const runScoped = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(effect))

const makeConnectedManager = (writeControl: (control: string) => Effect.Effect<void>) =>
  Effect.gen(function* () {
    const manager = yield* makeSubscriptionManager()
    yield* manager.runConnection(writeControl).pipe(Effect.forkScoped)
    return manager
  })

describe("订阅管理器", () => {
  /**
   * 测试将验证：
   *
   * 1. 首个消费者产生一次 subscribe。
   * 2. 相同 identity 的第二个消费者不重复 subscribe。
   * 3. 两个消费者接收同一条实时消息。
   * 4. 第一个消费者退出时不产生 unsubscribe。
   * 5. 最后一个消费者退出时只产生一次 unsubscribe。
   * 6. 只通过公开 API 与控制消息观察行为，不读取内部状态。
   */
  test("同一订阅实例的多个消费者共享消息与远端订阅", async () => {
    const controls: Array<string> = []
    const protocol = defineProtocol({
      schema: Schema.Struct({ id: Schema.String, value: Schema.Number }),
      subscriptionSchema: Schema.String,
      match: (_parsed: unknown, identity: string) => identity === "resource-1",
      subscription: (id: string) => ({
        identity: id,
        subscribe: () => `subscribe:${id}`,
        unsubscribe: () => `unsubscribe:${id}`,
      }),
    })

    await runScoped(
      Effect.gen(function* () {
        const manager = yield* makeConnectedManager((control) =>
          Effect.sync(() => controls.push(control)),
        )
        const firstScope = yield* Scope.make()
        const secondScope = yield* Scope.make()
        const firstMessage = yield* Deferred.make<unknown>()
        const secondMessage = yield* Deferred.make<unknown>()
        const stream = manager.stream(protocol, protocol.subscription("resource-1"))

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

        expect(controls).toEqual(["subscribe:resource-1"])

        yield* publishMatched(manager, { id: "resource-1" }, { id: "resource-1", value: 1 })

        expect(yield* Deferred.await(firstMessage)).toEqual({ id: "resource-1", value: 1 })
        expect(yield* Deferred.await(secondMessage)).toEqual({ id: "resource-1", value: 1 })

        yield* Scope.close(firstScope, Exit.void)
        expect(controls).toEqual(["subscribe:resource-1"])

        yield* Scope.close(secondScope, Exit.void)
        expect(controls).toEqual(["subscribe:resource-1", "unsubscribe:resource-1"])
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
      subscriptionSchema: Schema.String,
      match: (parsed: unknown, identity: string) =>
        typeof parsed === "object" && parsed !== null && "id" in parsed && parsed.id === identity,
      subscription: (id: string) => ({ identity: id }),
    })

    await runScoped(
      Effect.gen(function* () {
        const manager = yield* makeConnectedManager(() => Effect.void)
        const firstScope = yield* Scope.make()
        const secondScope = yield* Scope.make()
        const firstMessage = yield* Deferred.make<unknown>()
        const secondMessage = yield* Deferred.make<unknown>()

        const first = yield* Stream.runForEach(
          manager.stream(protocol, protocol.subscription("resource-1")),
          (message) => Deferred.succeed(firstMessage, message),
        ).pipe(Effect.forkIn(firstScope))
        const second = yield* Stream.runForEach(
          manager.stream(protocol, protocol.subscription("resource-2")),
          (message) => Deferred.succeed(secondMessage, message),
        ).pipe(Effect.forkIn(secondScope))
        yield* Effect.all([Fiber.status(first), Fiber.status(second)], {
          concurrency: "unbounded",
        }).pipe(
          Effect.filterOrFail((statuses) => statuses.every(FiberStatus.isSuspended)),
          Effect.eventually,
        )

        const resource1 = { id: "resource-1", value: 1 }
        yield* publishMatched(manager, resource1, resource1)
        expect(yield* Deferred.await(firstMessage)).toEqual(resource1)
        expect(Option.isNone(yield* Deferred.poll(secondMessage))).toBe(true)

        const resource2 = { id: "resource-2", value: 2 }
        yield* publishMatched(manager, resource2, resource2)
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
   * 5. 所有行为仅通过共享消息流观察，不检查消费者 Queue 或其容量。
   */
  test("慢消费者只保留最新待处理值且新消费者不接收历史值", async () => {
    const protocol = defineProtocol({
      schema: Schema.Number,
      match: (_parsed: unknown, identity: string) => identity === "updates",
      subscription: () => ({ identity: "updates" }),
    })

    await runScoped(
      Effect.gen(function* () {
        const manager = yield* makeConnectedManager(() => Effect.void)
        const firstScope = yield* Scope.make()
        const secondScope = yield* Scope.make()
        const firstStarted = yield* Deferred.make<void>()
        const resumeFirst = yield* Deferred.make<void>()
        const firstValues = yield* Ref.make<ReadonlyArray<number>>([])
        const firstReceivedFour = yield* Deferred.make<void>()
        const secondValue = yield* Deferred.make<number>()
        const stream = manager.stream(protocol, protocol.subscription())

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

        yield* publishMatched(manager, 1, 1)
        yield* Deferred.await(firstStarted)
        yield* publishMatched(manager, 2, 2)
        yield* publishMatched(manager, 3, 3)
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

        yield* publishMatched(manager, 4, 4)
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
    const controls: Array<string> = []
    const protocol = defineProtocol({
      schema: Schema.Number,
      match: (_parsed: unknown, identity: string) => identity === "updates",
      subscription: () => ({
        identity: "updates",
        subscribe: () => "subscribe:updates",
        unsubscribe: () => "unsubscribe:updates",
      }),
    })

    await runScoped(
      Effect.gen(function* () {
        const manager = yield* makeConnectedManager((control) =>
          Effect.sync(() => controls.push(control)),
        )
        const stream = manager.stream(protocol, protocol.subscription())

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
        yield* publishMatched(manager, 1, 1)
        expect(yield* Fiber.await(failingConsumer)).toEqual(Exit.fail("consumer failed"))
        expect(controls).toEqual(["subscribe:updates", "unsubscribe:updates"])

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
          "subscribe:updates",
          "unsubscribe:updates",
          "subscribe:updates",
          "unsubscribe:updates",
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
    const controls: Array<string> = []
    const protocol = defineProtocol({
      schema: Schema.Number,
      match: (_parsed: unknown, identity: string) => identity === "passive-updates",
      subscription: () => ({ identity: "passive-updates" }),
    })

    await runScoped(
      Effect.gen(function* () {
        const manager = yield* makeConnectedManager((control) =>
          Effect.sync(() => controls.push(control)),
        )
        const stream = manager.stream(protocol, protocol.subscription())

        const firstScope = yield* Scope.make()
        const firstMessage = yield* Deferred.make<number>()
        const first = yield* Stream.runForEach(stream, (message) =>
          Deferred.succeed(firstMessage, message),
        ).pipe(Effect.forkIn(firstScope))
        yield* Fiber.status(first).pipe(
          Effect.filterOrFail(FiberStatus.isSuspended),
          Effect.eventually,
        )
        yield* publishMatched(manager, 101, 101)
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
        yield* publishMatched(manager, 102, 102)
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
    const controls: Array<string> = []
    const protocol = defineProtocol({
      schema: Schema.Number,
      match: (_parsed: unknown, identity: string) => identity === "updates",
      subscription: () => ({
        identity: "updates",
        subscribe: () => "subscribe:updates",
        unsubscribe: () => "unsubscribe:updates",
      }),
    })

    await runScoped(
      Effect.gen(function* () {
        const manager = yield* makeConnectedManager((control) =>
          Effect.sync(() => controls.push(control)),
        )
        const stream = manager.stream(protocol, protocol.subscription())
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

        expect(controls).toEqual(["subscribe:updates"])

        yield* Effect.forEach(consumers, Fiber.interrupt, {
          concurrency: "unbounded",
          discard: true,
        })
        const completed = yield* Effect.sync(() => controls.slice()).pipe(
          Effect.filterOrFail((current) => current.length === 2),
          Effect.eventually,
        )
        expect(completed).toEqual(["subscribe:updates", "unsubscribe:updates"])

        yield* Effect.forEach(scopes, (scope) => Scope.close(scope, Exit.void), {
          concurrency: "unbounded",
          discard: true,
        })
      }),
    )
  })

  /**
   * 测试将验证：
   *
   * 1. 首个消费者建立订阅实例和广播订阅后才发送 subscribe。
   * 2. control writer 处理 subscribe 时立即发布服务器响应。
   * 3. 首个消费者不会丢失该即时响应。
   * 4. 消费者退出时只产生一次 unsubscribe。
   * 5. 最终控制消息严格为 subscribe → unsubscribe。
   */
  test("本地订阅先于 subscribe 建立并接收即时响应", async () => {
    const controls: Array<string> = []
    const protocol = defineProtocol({
      schema: Schema.Number,
      match: (_parsed: unknown, identity: string) => identity === "updates",
      subscription: () => ({
        identity: "updates",
        subscribe: () => "subscribe:updates",
        unsubscribe: () => "unsubscribe:updates",
      }),
    })

    await runScoped(
      Effect.gen(function* () {
        let manager: SubscriptionManager
        manager = yield* makeConnectedManager((control) =>
          Effect.gen(function* () {
            controls.push(control)
            if (control === "subscribe:updates") {
              yield* publishMatched(manager, 101, 101)
            }
          }),
        )
        const scope = yield* Scope.make()
        const message = yield* Deferred.make<number>()
        const consumer = yield* Stream.runForEach(
          manager.stream(protocol, protocol.subscription()),
          (value) => Deferred.succeed(message, value),
        ).pipe(Effect.forkIn(scope))

        expect(yield* Deferred.await(message)).toBe(101)

        yield* Fiber.interrupt(consumer)
        expect(controls).toEqual(["subscribe:updates", "unsubscribe:updates"])
        yield* Scope.close(scope, Exit.void)
      }),
    )
  })

  /**
   * 测试将验证：
   *
   * 1. 按 A1 → B1 → A2 的全局顺序创建三个订阅实例。
   * 2. A1 不匹配测试消息，B1 与 A2 同时匹配。
   * 3. 路由选择全局创建顺序更早的 B1，而不是同协议 Map 中的 A2。
   * 4. B1 消费者收到上层发布的已解码值，A1 与 A2 均不接收。
   * 5. matcher 调用参数依次为 A1 → B1，证明其接收当前实例 identity。
   * 6. 找到 B1 后停止匹配，不再调用 A2 的 matcher。
   * 7. 测试只使用公开 match 与 Stream seam，不读取内部顺序记录或 Map。
   */
  test("跨协议重叠匹配按全局创建顺序取第一个目标", async () => {
    const matcherCalls: Array<string> = []
    const match = (parsed: unknown, identity: string) => {
      matcherCalls.push(identity)
      return (
        typeof parsed === "object" &&
        parsed !== null &&
        "identities" in parsed &&
        Array.isArray(parsed.identities) &&
        parsed.identities.includes(identity)
      )
    }
    const protocolA = defineProtocol({
      schema: Schema.Number,
      subscriptionSchema: Schema.String,
      match,
      subscription: (identity: string) => ({ identity }),
    })
    const protocolB = defineProtocol({
      schema: Schema.Number,
      subscriptionSchema: Schema.String,
      match,
      subscription: (identity: string) => ({ identity }),
    })

    await runScoped(
      Effect.gen(function* () {
        const manager = yield* makeConnectedManager(() => Effect.void)
        const a1Scope = yield* Scope.make()
        const b1Scope = yield* Scope.make()
        const a2Scope = yield* Scope.make()
        const a1Message = yield* Deferred.make<number>()
        const b1Message = yield* Deferred.make<number>()
        const a2Message = yield* Deferred.make<number>()

        const a1 = yield* Stream.runForEach(
          manager.stream(protocolA, protocolA.subscription("A1")),
          (message) => Deferred.succeed(a1Message, message),
        ).pipe(Effect.forkIn(a1Scope))
        yield* Fiber.status(a1).pipe(
          Effect.filterOrFail(FiberStatus.isSuspended),
          Effect.eventually,
        )
        const b1 = yield* Stream.runForEach(
          manager.stream(protocolB, protocolB.subscription("B1")),
          (message) => Deferred.succeed(b1Message, message),
        ).pipe(Effect.forkIn(b1Scope))
        yield* Fiber.status(b1).pipe(
          Effect.filterOrFail(FiberStatus.isSuspended),
          Effect.eventually,
        )
        const a2 = yield* Stream.runForEach(
          manager.stream(protocolA, protocolA.subscription("A2")),
          (message) => Deferred.succeed(a2Message, message),
        ).pipe(Effect.forkIn(a2Scope))
        yield* Fiber.status(a2).pipe(
          Effect.filterOrFail(FiberStatus.isSuspended),
          Effect.eventually,
        )

        const target = yield* manager.match({ identities: ["B1", "A2"] })
        expect(Option.isSome(target)).toBe(true)
        if (Option.isSome(target)) yield* target.value.publish(101)

        expect(yield* Deferred.await(b1Message)).toBe(101)
        expect(Option.isNone(yield* Deferred.poll(a1Message))).toBe(true)
        expect(Option.isNone(yield* Deferred.poll(a2Message))).toBe(true)
        expect(matcherCalls).toEqual(["A1", "B1"])

        yield* Scope.close(a1Scope, Exit.void)
        yield* Scope.close(b1Scope, Exit.void)
        yield* Scope.close(a2Scope, Exit.void)
      }),
    )
  })

  /**
   * 测试将验证：
   *
   * 1. 两个协议使用各自全局唯一的 identity 建立订阅实例。
   * 2. 两个实例分别产生自己的 subscribe 控制消息。
   * 3. 按第一个协议键发布的消息只由第一个消费者接收。
   * 4. 按第二个协议键发布的消息只由第二个消费者接收。
   * 5. 两个实例分别产生自己的 unsubscribe 控制消息。
   * 6. 订阅实例只通过全局唯一 identity 关联。
   */
  test("不同协议以全局唯一 identity 建立独立订阅实例", async () => {
    const controls: Array<string> = []
    const updateProtocol = defineProtocol({
      schema: Schema.Number,
      match: (parsed: unknown, identity: string) =>
        typeof parsed === "object" &&
        parsed !== null &&
        "type" in parsed &&
        parsed.type === "update" &&
        "id" in parsed &&
        parsed.id === identity,
      subscription: () => ({
        identity: "update:resource-1",
        subscribe: () => "subscribe:update:resource-1",
        unsubscribe: () => "unsubscribe:update:resource-1",
      }),
    })
    const statusProtocol = defineProtocol({
      schema: Schema.String,
      match: (parsed: unknown, identity: string) =>
        typeof parsed === "object" &&
        parsed !== null &&
        "type" in parsed &&
        parsed.type === "status" &&
        "id" in parsed &&
        parsed.id === identity,
      subscription: () => ({
        identity: "status:resource-1",
        subscribe: () => "subscribe:status:resource-1",
        unsubscribe: () => "unsubscribe:status:resource-1",
      }),
    })

    await runScoped(
      Effect.gen(function* () {
        const manager = yield* makeConnectedManager((control) =>
          Effect.sync(() => controls.push(control)),
        )
        const updateScope = yield* Scope.make()
        const statusScope = yield* Scope.make()
        const updateMessage = yield* Deferred.make<number>()
        const statusMessage = yield* Deferred.make<string>()

        const updateConsumer = yield* Stream.runForEach(
          manager.stream(updateProtocol, updateProtocol.subscription()),
          (message) => Deferred.succeed(updateMessage, message),
        ).pipe(Effect.forkIn(updateScope))
        const statusConsumer = yield* Stream.runForEach(
          manager.stream(statusProtocol, statusProtocol.subscription()),
          (message) => Deferred.succeed(statusMessage, message),
        ).pipe(Effect.forkIn(statusScope))
        yield* Effect.all([Fiber.status(updateConsumer), Fiber.status(statusConsumer)], {
          concurrency: "unbounded",
        }).pipe(
          Effect.filterOrFail((statuses) => statuses.every(FiberStatus.isSuspended)),
          Effect.eventually,
        )

        expect(controls).toEqual(["subscribe:update:resource-1", "subscribe:status:resource-1"])

        yield* publishMatched(manager, { type: "update", id: "update:resource-1" }, 101)
        expect(yield* Deferred.await(updateMessage)).toBe(101)
        expect(Option.isNone(yield* Deferred.poll(statusMessage))).toBe(true)

        yield* publishMatched(manager, { type: "status", id: "status:resource-1" }, "active")
        expect(yield* Deferred.await(statusMessage)).toBe("active")

        yield* Scope.close(updateScope, Exit.void)
        yield* Scope.close(statusScope, Exit.void)
        expect(controls).toEqual([
          "subscribe:update:resource-1",
          "subscribe:status:resource-1",
          "unsubscribe:update:resource-1",
          "unsubscribe:status:resource-1",
        ])
      }),
    )
  })

  /**
   * 测试将验证：
   *
   * 1. 第一个 subscribe 进入 control writer 后可以被暂停。
   * 2. writer 暂停期间，后续 Acquire 保持在同一事件队列中。
   * 3. 第二个 subscribe 不会绕过仍在发送的第一个 subscribe。
   * 4. writer 恢复后，两个 subscribe 严格按 A → B 的顺序发送。
   * 5. B 被事件 Fiber 建立后可以收到匹配消息。
   * 6. 两个 unsubscribe 继续按 A → B 的事件顺序发送。
   * 7. 测试只观察公开 Stream、消息与 control writer，不读取内部 Queue 或 Fiber。
   */
  test("控制消息通过独立 FIFO sender 发送", async () => {
    const controls: Array<string> = []
    const protocol = defineProtocol({
      schema: Schema.Number,
      subscriptionSchema: Schema.String,
      match: (parsed: unknown, identity: string) => parsed === identity,
      subscription: (identity: string) => ({
        identity,
        subscribe: () => `subscribe:${identity}`,
        unsubscribe: () => `unsubscribe:${identity}`,
      }),
    })

    await runScoped(
      Effect.scoped(
        Effect.gen(function* () {
          const firstWriteStarted = yield* Deferred.make<void>()
          const resumeFirstWrite = yield* Deferred.make<void>()
          const manager = yield* makeConnectedManager((control) =>
            Effect.gen(function* () {
              controls.push(control)
              if (control === "subscribe:A") {
                yield* Deferred.succeed(firstWriteStarted, undefined)
                yield* Deferred.await(resumeFirstWrite)
              }
            }),
          )
          const firstScope = yield* Scope.make()
          const secondScope = yield* Scope.make()
          const secondMessage = yield* Deferred.make<number>()

          yield* Stream.runDrain(manager.stream(protocol, protocol.subscription("A"))).pipe(
            Effect.forkIn(firstScope),
          )
          yield* Deferred.await(firstWriteStarted)

          yield* Stream.runForEach(
            manager.stream(protocol, protocol.subscription("B")),
            (message) => Deferred.succeed(secondMessage, message),
          ).pipe(Effect.forkIn(secondScope))
          expect(controls).toEqual(["subscribe:A"])

          yield* Deferred.succeed(resumeFirstWrite, undefined)
          const subscribed = yield* Effect.sync(() => controls.slice()).pipe(
            Effect.filterOrFail((current) => current.length === 2),
            Effect.zipLeft(Effect.yieldNow()),
            Effect.eventually,
          )
          expect(subscribed).toEqual(["subscribe:A", "subscribe:B"])
          yield* publishMatched(manager, "B", 202)
          expect(yield* Deferred.await(secondMessage)).toBe(202)

          yield* Scope.close(firstScope, Exit.void)
          yield* Scope.close(secondScope, Exit.void)
          const completed = yield* Effect.sync(() => controls.slice()).pipe(
            Effect.filterOrFail((current) => current.length === 4),
            Effect.zipLeft(Effect.yieldNow()),
            Effect.eventually,
          )
          expect(completed).toEqual([
            "subscribe:A",
            "subscribe:B",
            "unsubscribe:A",
            "unsubscribe:B",
          ])
        }),
      ),
    )
  })
})
