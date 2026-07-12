import { afterEach, describe, expect, test } from "bun:test"
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Ref, Scope, Stream } from "effect"
import { PageVisibilitySignal, PageVisibilitySignalLive } from "../src/PageVisibilitySignal"

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document")

const installDocument = (visibilityState: DocumentVisibilityState) => {
  const browserDocument = new EventTarget() as EventTarget & {
    visibilityState: DocumentVisibilityState
  }
  browserDocument.visibilityState = visibilityState
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: browserDocument,
  })
  return {
    dispatch(nextVisibilityState: DocumentVisibilityState) {
      browserDocument.visibilityState = nextVisibilityState
      browserDocument.dispatchEvent(new Event("visibilitychange"))
    },
  }
}

afterEach(() => {
  if (originalDocument === undefined) {
    Reflect.deleteProperty(globalThis, "document")
  } else {
    Object.defineProperty(globalThis, "document", originalDocument)
  }
})

describe("页面可见信号", () => {
  test("初始值来自浏览器当前页面可见状态", async () => {
    installDocument("hidden")

    const isVisible = await Effect.runPromise(
      Effect.gen(function* () {
        const visibility = yield* PageVisibilitySignal
        return yield* visibility.get
      }).pipe(Effect.provide(PageVisibilitySignalLive)),
    )

    expect(isVisible).toBe(false)
  })

  test("所有消费者接收同一个最新页面可见状态", async () => {
    const browserDocument = installDocument("hidden")

    const values = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const visibility = yield* PageVisibilitySignal
          const firstReady = yield* Deferred.make<void>()
          const secondReady = yield* Deferred.make<void>()
          const first = yield* visibility.changes.pipe(
            Stream.tap((value) => (value ? Effect.void : Deferred.succeed(firstReady, undefined))),
            Stream.take(2),
            Stream.runCollect,
            Effect.fork,
          )
          const second = yield* visibility.changes.pipe(
            Stream.tap((value) => (value ? Effect.void : Deferred.succeed(secondReady, undefined))),
            Stream.take(2),
            Stream.runCollect,
            Effect.fork,
          )
          yield* Effect.all([Deferred.await(firstReady), Deferred.await(secondReady)])
          browserDocument.dispatch("visible")
          return yield* Effect.all([Fiber.join(first), Fiber.join(second)])
        }).pipe(Effect.provide(PageVisibilitySignalLive)),
      ),
    )

    expect(values.map((value) => Array.from(value))).toEqual([
      [false, true],
      [false, true],
    ])
  })

  test("慢消费者跳过过时状态且相同状态不重复发布", async () => {
    const browserDocument = installDocument("hidden")

    const values = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const visibility = yield* PageVisibilitySignal
          const firstStarted = yield* Deferred.make<void>()
          const resume = yield* Deferred.make<void>()
          const received = yield* Ref.make<ReadonlyArray<boolean>>([])
          const consumer = yield* visibility.changes.pipe(
            Stream.take(2),
            Stream.runForEach((value) =>
              Effect.gen(function* () {
                yield* Ref.update(received, (receivedValues) => [...receivedValues, value])
                if (!value) {
                  yield* Deferred.succeed(firstStarted, undefined)
                  yield* Deferred.await(resume)
                }
              }),
            ),
            Effect.fork,
          )

          yield* Deferred.await(firstStarted)
          browserDocument.dispatch("hidden")
          browserDocument.dispatch("visible")
          browserDocument.dispatch("hidden")
          browserDocument.dispatch("visible")
          yield* Deferred.succeed(resume, undefined)
          yield* Fiber.join(consumer)
          return yield* Ref.get(received)
        }).pipe(Effect.provide(PageVisibilitySignalLive)),
      ),
    )

    expect(values).toEqual([false, true])
  })

  test("document 为 undefined 时以浏览器环境 defect 失败", async () => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: undefined,
    })

    const exit = await Effect.runPromiseExit(
      Effect.void.pipe(Effect.provide(PageVisibilitySignalLive)),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Array.from(Cause.defects(exit.cause), String)).toEqual([
        "Error: PageVisibilitySignal requires a browser environment",
      ])
    }
  })

  test("Scope 关闭后停止响应页面可见性事件", async () => {
    const browserDocument = installDocument("hidden")

    const value = await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const context = yield* Layer.buildWithScope(PageVisibilitySignalLive, scope)
        const visibility = Context.get(context, PageVisibilitySignal)
        yield* Scope.close(scope, Exit.void)
        browserDocument.dispatch("visible")
        return yield* visibility.get
      }),
    )

    expect(value).toBe(false)
  })
})
