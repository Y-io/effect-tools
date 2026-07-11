import { describe, expect, test } from "bun:test"
import * as Socket from "@effect/platform/Socket"
import { Effect, Exit, Fiber, Option, Scope, Stream } from "effect"
import { makeWebSocketConnection } from "../src/index"
import {
  makeControllableSocket,
  makeControllableWebSocketConnection,
} from "./support/controllable-websocket-connection"

describe("WebSocket 连接", () => {
  /**
   * 测试将验证：
   *
   * 1. Effect Socket 尚未触发 onOpen 时，连接构造 Effect 保持等待。
   * 2. onOpen 触发后，构造 Effect 才返回当前 connection epoch。
   * 3. open 前失败时构造 Effect 返回 SocketError，不会永久等待。
   * 4. 调用方无需额外读取 isConnected 状态。
   */
  test("等待 Effect Socket open 后才返回 connection epoch", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const control = yield* makeControllableSocket()
          const connecting = yield* makeWebSocketConnection(control.socket).pipe(Effect.fork)
          yield* Effect.yieldNow()
          expect(Option.isNone(yield* Fiber.poll(connecting))).toBe(true)

          yield* control.open
          yield* Fiber.join(connecting)
          expect(Option.isSome(yield* Fiber.poll(connecting))).toBe(true)

          const failed = yield* makeControllableSocket()
          const failedConnection = yield* makeWebSocketConnection(failed.socket).pipe(
            Effect.exit,
            Effect.fork,
          )
          const error = new Socket.SocketGenericError({ reason: "Open", cause: "failed" })
          yield* failed.failOpen(error)
          expect(yield* Fiber.join(failedConnection)).toEqual(Exit.fail(error))
        }),
      ),
    )
  })

  /**
   * 测试将验证：
   *
   * 1. 公开 frames 保留 Effect Socket 的文本与二进制 raw frame。
   * 2. connection 不执行 parser 或 Schema 解码。
   */
  test("通过公开接口消费 Effect Socket raw frame", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeControllableWebSocketConnection()
          const frames = yield* Stream.take(fake.connection.frames, 2).pipe(
            Stream.runCollect,
            Effect.fork,
          )
          yield* fake.emitFrame("raw text")
          yield* fake.emitFrame(new Uint8Array([1, 2, 3]))

          expect(Array.from(yield* Fiber.join(frames))).toEqual([
            "raw text",
            new Uint8Array([1, 2, 3]),
          ])
        }),
      ),
    )
  })

  /**
   * 测试将验证：
   *
   * 1. 正常发送通过 Effect Socket writer。
   * 2. writer 失败返回原始 SocketError。
   * 3. writer 失败会终止并释放当前 connection epoch。
   * 4. 外部只观察 epoch 已终止，不由 connection 决定是否重连。
   */
  test("发送失败会结束并释放当前 connection epoch", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeControllableWebSocketConnection()
          yield* fake.connection.send("subscribe")
          expect(yield* fake.takeSent).toBe("subscribe")

          const error = new Socket.SocketGenericError({ reason: "Write", cause: "failed" })
          yield* fake.failNextSend(error)
          expect(yield* fake.connection.send("unsubscribe").pipe(Effect.exit)).toEqual(
            Exit.fail(error),
          )
          yield* fake.connection.termination
          yield* fake.runReleased
        }),
      ),
    )
  })

  /**
   * 测试将验证：
   *
   * 1. 远端断开会完成公开 termination。
   * 2. 公开 close 也会完成同一个 termination。
   * 3. 两条路径都在 termination 前释放 runRaw 资源。
   */
  test("远端断开与本地关闭都会先释放资源再通知 epoch 终止", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const remote = yield* makeControllableWebSocketConnection()
          yield* remote.disconnect(1001, "going away")
          yield* remote.connection.termination
          yield* remote.runReleased

          const local = yield* makeControllableWebSocketConnection()
          yield* local.connection.close
          yield* local.connection.termination
          yield* local.runReleased
        }),
      ),
    )
  })

  /**
   * 测试将验证：
   *
   * 1. connection Scope 结束会请求底层 Effect Socket 关闭。
   * 2. scoped runRaw Fiber 被释放。
   * 3. 重复清理不会重复发送 close。
   */
  test("Scope 结束会确定性释放 Effect Socket epoch", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const fake = yield* makeControllableSocket().pipe(Effect.provideService(Scope.Scope, scope))
        yield* fake.open
        yield* makeWebSocketConnection(fake.socket).pipe(Effect.provideService(Scope.Scope, scope))

        yield* Scope.close(scope, Exit.void)
        return {
          closes: yield* fake.closeCount,
          released: yield* fake.runReleased.pipe(Effect.as(true)),
        }
      }),
    )

    expect(result).toEqual({ closes: 1, released: true })
  })
})
