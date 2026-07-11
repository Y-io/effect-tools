import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Exit, Stream } from "effect"
import { makeWebSocketConnection } from "../src/index"

describe("WebSocket 连接", () => {
  test("通过公开接口消费未经解析的 raw frame", async () => {
    const frames = ["raw text", new Uint8Array([1, 2, 3])] as const
    const received = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* makeWebSocketConnection({
            frames: Stream.fromIterable(frames),
            write: () => Effect.void,
            awaitTermination: Effect.never,
            close: Effect.void,
          })
          return yield* Stream.runCollect(connection.frames)
        }),
      ),
    )

    expect(Array.from(received)).toEqual([...frames])
  })

  test("控制消息按调用顺序发送且底层发送失败返回调用方", async () => {
    const writes: Array<string> = []

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const releaseFirst = yield* Deferred.make<void>()
          const connection = yield* makeWebSocketConnection({
            frames: Stream.empty,
            write: (control: string) =>
              Effect.gen(function* () {
                writes.push(control)
                if (control === "first") yield* Deferred.await(releaseFirst)
                if (control === "second") return yield* Effect.fail("send failed" as const)
              }),
            awaitTermination: Effect.never,
            close: Effect.void,
          })

          const first = yield* connection.send("first").pipe(Effect.fork)
          const second = yield* connection.send("second").pipe(Effect.fork)
          yield* Effect.yieldNow()

          expect(writes).toEqual(["first"])
          yield* Deferred.succeed(releaseFirst, undefined)

          return yield* Effect.all([first, second].map(Effect.exit))
        }),
      ),
    )

    expect(writes).toEqual(["first", "second"])
    expect(result).toEqual([Exit.void, Exit.fail("send failed")])
  })

  test("报告远端断开、本地关闭及底层失败", async () => {
    const remoteClose = { _tag: "RemoteClose", code: 1000, reason: "server shutdown" } as const
    const failure = { _tag: "Failure", error: "socket failed" } as const

    const terminations = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const remoteSignal = yield* Deferred.make<typeof remoteClose>()
          const failureSignal = yield* Deferred.make<typeof failure>()
          const remote = yield* makeWebSocketConnection({
            frames: Stream.empty,
            write: () => Effect.void,
            awaitTermination: Deferred.await(remoteSignal),
            close: Effect.void,
          })
          const local = yield* makeWebSocketConnection({
            frames: Stream.empty,
            write: () => Effect.void,
            awaitTermination: Effect.never,
            close: Effect.void,
          })
          const failed = yield* makeWebSocketConnection({
            frames: Stream.empty,
            write: () => Effect.void,
            awaitTermination: Deferred.await(failureSignal),
            close: Effect.void,
          })

          yield* Deferred.succeed(remoteSignal, remoteClose)
          yield* local.close
          yield* Deferred.succeed(failureSignal, failure)

          return yield* Effect.all([remote.termination, local.termination, failed.termination])
        }),
      ),
    )

    expect(terminations).toEqual([remoteClose, { _tag: "LocalClose" }, failure])
  })
})
