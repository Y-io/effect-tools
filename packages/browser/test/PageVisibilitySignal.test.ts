import { afterEach, describe, expect, test } from "bun:test"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Logger, Ref, Scope, Stream } from "effect"
import { makePageVisibilitySignalLive, PageVisibilitySignal } from "../src/PageVisibilitySignal"

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document")
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator")

const installDocument = (visibilityState: DocumentVisibilityState) => {
  const browserDocument = new EventTarget() as EventTarget & {
    visibilityState: DocumentVisibilityState
  }
  browserDocument.visibilityState = visibilityState
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: browserDocument,
  })
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: new EventTarget(),
  })
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {},
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
  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window")
  } else {
    Object.defineProperty(globalThis, "window", originalWindow)
  }
  if (originalNavigator === undefined) {
    Reflect.deleteProperty(globalThis, "navigator")
  } else {
    Object.defineProperty(globalThis, "navigator", originalNavigator)
  }
})

describe("页面可见信号", () => {
  test("初始值来自浏览器当前页面可见状态", async () => {
    installDocument("hidden")

    const isVisible = await Effect.runPromise(
      Effect.gen(function* () {
        const visibility = yield* PageVisibilitySignal
        return yield* visibility.get
      }).pipe(Effect.provide(makePageVisibilitySignalLive())),
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
        }).pipe(Effect.provide(makePageVisibilitySignalLive())),
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
        }).pipe(Effect.provide(makePageVisibilitySignalLive())),
      ),
    )

    expect(values).toEqual([false, true])
  })

  test("非浏览器环境记录错误并默认页面可见", async () => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: undefined,
    })

    const isVisible = await Effect.runPromise(
      Effect.gen(function* () {
        const visibility = yield* PageVisibilitySignal
        return yield* visibility.get
      }).pipe(Effect.provide(makePageVisibilitySignalLive())),
    )

    expect(isVisible).toBe(true)
  })

  test("非浏览器环境使用外部传入的默认值", async () => {
    Reflect.deleteProperty(globalThis, "document")

    const isVisible = await Effect.runPromise(
      Effect.gen(function* () {
        const visibility = yield* PageVisibilitySignal
        return yield* visibility.get
      }).pipe(Effect.provide(makePageVisibilitySignalLive(false))),
    )

    expect(isVisible).toBe(false)
  })

  test("读取浏览器状态失败时记录错误并使用默认值", async () => {
    const browserDocument = installDocument("visible")
    let state: DocumentVisibilityState = "visible"
    let reads = 0
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get() {
        if (reads++ === 0) {
          throw new Error("visibility state unavailable")
        }
        return state
      },
      set(value: DocumentVisibilityState) {
        state = value
      },
    })
    const logs: Array<{ readonly level: string; readonly message: string }> = []
    const logger = Logger.make(({ logLevel, message }) => {
      logs.push({
        level: logLevel.label,
        message: Array.isArray(message) ? message.map(String).join(" ") : String(message),
      })
    })

    const values = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const visibility = yield* PageVisibilitySignal
          const initial = yield* visibility.get
          browserDocument.dispatch("visible")
          const recovered = yield* visibility.get
          return [initial, recovered] as const
        }).pipe(Effect.provide(makePageVisibilitySignalLive(false))),
      ).pipe(Effect.provide(Logger.replace(Logger.defaultLogger, logger))),
    )

    expect(values).toEqual([false, true])
    expect(logs).toHaveLength(1)
    expect(logs[0]?.level).toBe("ERROR")
    expect(logs[0]?.message).toContain(
      "PageVisibilitySignal failed to read browser value; defaulting to false",
    )
  })

  test("Scope 关闭后停止响应页面可见性事件", async () => {
    const browserDocument = installDocument("hidden")

    const value = await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const context = yield* Layer.buildWithScope(makePageVisibilitySignalLive(), scope)
        const visibility = Context.get(context, PageVisibilitySignal)
        yield* Scope.close(scope, Exit.void)
        browserDocument.dispatch("visible")
        return yield* visibility.get
      }),
    )

    expect(value).toBe(false)
  })
})
