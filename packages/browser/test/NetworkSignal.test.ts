import { afterEach, describe, expect, test } from "bun:test"
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Ref, Scope, Stream } from "effect"
import { NetworkSignal, NetworkSignalLive } from "../src/NetworkSignal"

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document")
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator")

const installBrowser = (onLine: boolean) => {
  const browserNavigator = { onLine }
  const browserWindow = new EventTarget() as EventTarget & {
    readonly navigator: { onLine: boolean }
  }
  Object.defineProperty(browserWindow, "navigator", { value: browserNavigator })
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: browserWindow,
  })
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: new EventTarget(),
  })
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: browserNavigator,
  })
  return {
    dispatch(isOnline: boolean) {
      browserWindow.navigator.onLine = isOnline
      browserWindow.dispatchEvent(new Event(isOnline ? "online" : "offline"))
    },
  }
}

afterEach(() => {
  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window")
  } else {
    Object.defineProperty(globalThis, "window", originalWindow)
  }
  if (originalDocument === undefined) {
    Reflect.deleteProperty(globalThis, "document")
  } else {
    Object.defineProperty(globalThis, "document", originalDocument)
  }
  if (originalNavigator === undefined) {
    Reflect.deleteProperty(globalThis, "navigator")
  } else {
    Object.defineProperty(globalThis, "navigator", originalNavigator)
  }
})

describe("网络信号", () => {
  test("初始值来自浏览器当前网络状态", async () => {
    installBrowser(false)

    const isOnline = await Effect.runPromise(
      Effect.gen(function* () {
        const network = yield* NetworkSignal
        return yield* network.get
      }).pipe(Effect.provide(NetworkSignalLive)),
    )

    expect(isOnline).toBe(false)
  })

  test("所有消费者接收同一个最新网络状态", async () => {
    const browser = installBrowser(false)

    const values = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const network = yield* NetworkSignal
          const firstReady = yield* Deferred.make<void>()
          const secondReady = yield* Deferred.make<void>()
          const first = yield* network.changes.pipe(
            Stream.tap((value) => (value ? Effect.void : Deferred.succeed(firstReady, undefined))),
            Stream.take(2),
            Stream.runCollect,
            Effect.fork,
          )
          const second = yield* network.changes.pipe(
            Stream.tap((value) => (value ? Effect.void : Deferred.succeed(secondReady, undefined))),
            Stream.take(2),
            Stream.runCollect,
            Effect.fork,
          )
          yield* Effect.all([Deferred.await(firstReady), Deferred.await(secondReady)])
          browser.dispatch(true)
          return yield* Effect.all([Fiber.join(first), Fiber.join(second)])
        }).pipe(Effect.provide(NetworkSignalLive)),
      ),
    )

    expect(values.map((value) => Array.from(value))).toEqual([
      [false, true],
      [false, true],
    ])
  })

  test("慢消费者跳过过时状态且相同状态不重复发布", async () => {
    const browser = installBrowser(false)

    const values = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const network = yield* NetworkSignal
          const firstStarted = yield* Deferred.make<void>()
          const resume = yield* Deferred.make<void>()
          const received = yield* Ref.make<ReadonlyArray<boolean>>([])
          const consumer = yield* network.changes.pipe(
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
          browser.dispatch(false)
          browser.dispatch(true)
          browser.dispatch(false)
          browser.dispatch(true)
          yield* Deferred.succeed(resume, undefined)
          yield* Fiber.join(consumer)
          return yield* Ref.get(received)
        }).pipe(Effect.provide(NetworkSignalLive)),
      ),
    )

    expect(values).toEqual([false, true])
  })

  test("非浏览器 runtime 构造时以 defect 失败", async () => {
    Reflect.deleteProperty(globalThis, "window")

    const exit = await Effect.runPromiseExit(Effect.void.pipe(Effect.provide(NetworkSignalLive)))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Array.from(Cause.defects(exit.cause), String)).toEqual([
        "Error: NetworkSignal requires a browser environment",
      ])
    }
  })

  test("Scope 关闭后停止响应浏览器网络事件", async () => {
    const browser = installBrowser(false)

    const value = await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const context = yield* Layer.buildWithScope(NetworkSignalLive, scope)
        const network = Context.get(context, NetworkSignal)
        yield* Scope.close(scope, Exit.void)
        browser.dispatch(true)
        return yield* network.get
      }),
    )

    expect(value).toBe(false)
  })
})
