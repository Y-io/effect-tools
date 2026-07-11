import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Exit, Fiber, FiberStatus, Option, Schema, Scope, Stream } from "effect"
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
})
