import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Option, Scope, Stream } from "effect"
import { makeWebSocketConnection, type WebSocketConnection } from "../src/index"
import { makeControllableWebSocketConnection } from "./support/controllable-websocket-connection"

describe("WebSocket 连接", () => {
  /**
   * 测试将验证：
   *
   * 1. 公开连接接口暴露 raw-frame Stream。
   * 2. 文本与二进制 frame 保持原值，不在连接边界解析或解码。
   */
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

  /**
   * 测试将验证：
   *
   * 1. 第一条底层写入挂起时，第二条不会越过它发送。
   * 2. 第一条完成后，第二条按调用顺序写入。
   * 3. 底层发送失败返回对应 send 调用方，不丢失具体错误。
   */
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

  /**
   * 测试将验证：
   *
   * 1. transport 可以报告带关闭信息的远端断开。
   * 2. 公开 close 报告本地关闭。
   * 3. transport 可以报告底层连接失败及其错误值。
   * 4. 三种结果都通过同一个公开 termination 信号观察。
   */
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

  /**
   * 测试将验证：
   *
   * 1. 关闭连接 Scope 会调用底层 transport close。
   * 2. 挂起的 raw-frame 消费会被中断并执行资源 finalizer。
   * 3. 挂起的控制消息发送会被中断并执行资源 finalizer。
   * 4. 清理行为只通过公开 frames、send 与 adapter seam 观察。
   */
  test("Scope 结束会关闭连接并释放接收与发送资源", async () => {
    const closed: Array<string> = []

    const released = await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const receiveStarted = yield* Deferred.make<void>()
        const receiveReleased = yield* Deferred.make<void>()
        const sendStarted = yield* Deferred.make<void>()
        const sendReleased = yield* Deferred.make<void>()
        const frames = Stream.fromEffect(Deferred.succeed(receiveStarted, undefined)).pipe(
          Stream.concat(Stream.never),
          Stream.ensuring(Deferred.succeed(receiveReleased, undefined)),
        )
        const connection = yield* makeWebSocketConnection({
          frames,
          write: () =>
            Deferred.succeed(sendStarted, undefined).pipe(
              Effect.zipRight(Effect.never),
              Effect.ensuring(Deferred.succeed(sendReleased, undefined)),
            ),
          awaitTermination: Effect.never,
          close: Effect.sync(() => closed.push("closed")),
        }).pipe(Effect.provideService(Scope.Scope, scope))

        const receiver = yield* Stream.runDrain(connection.frames).pipe(Effect.forkIn(scope))
        const sender = yield* connection.send("subscribe").pipe(Effect.forkIn(scope))
        yield* Deferred.await(receiveStarted)
        yield* Deferred.await(sendStarted)

        yield* Scope.close(scope, Exit.void)

        return {
          receiveReleased: yield* Deferred.isDone(receiveReleased),
          sendReleased: yield* Deferred.isDone(sendReleased),
          receiver: yield* Fiber.await(receiver),
          sender: yield* Fiber.await(sender),
        }
      }),
    )

    expect(closed).toEqual(["closed"])
    expect(released.receiveReleased).toBe(true)
    expect(released.sendReleased).toBe(true)
    expect(Exit.isInterrupted(released.receiver)).toBe(true)
    expect(Exit.isInterrupted(released.sender)).toBe(true)
  })

  /**
   * 测试将验证：
   *
   * 1. fake connection 可赋值给同一个公开 WebSocketConnection 接口。
   * 2. fake 可以注入 raw frame，并由公开 frames Stream 消费。
   * 3. fake 可以观察正常发送并令下一次发送失败。
   * 4. fake 可以发出带 code 与 reason 的远端断开。
   * 5. 测试控制能力不要求业务消费者访问连接内部状态。
   */
  test("可控 fake 通过同一连接接口发出 frame、断线和发送失败", async () => {
    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeControllableWebSocketConnection<string, string, string>()
          const connection: WebSocketConnection<string, string, string> = fake.connection
          const receivedFrame = yield* Stream.runHead(connection.frames).pipe(Effect.fork)

          yield* fake.emitFrame("raw frame")
          yield* connection.send("subscribe")
          const sent = yield* fake.takeSent
          yield* fake.failNextSend("send failed")
          const sendFailure = yield* connection.send("unsubscribe").pipe(Effect.exit)
          yield* fake.disconnect(1001, "going away")

          return {
            frame: yield* Fiber.join(receivedFrame),
            sent,
            sendFailure,
            termination: yield* connection.termination,
          }
        }),
      ),
    )

    expect(observed).toEqual({
      frame: Option.some("raw frame"),
      sent: "subscribe",
      sendFailure: Exit.fail("send failed"),
      termination: { _tag: "RemoteClose", code: 1001, reason: "going away" },
    })
  })
})
