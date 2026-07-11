import { Deferred, Effect, Queue } from "effect"
import type { Scope, Stream } from "effect"

interface SendRequest<Control, SendError> {
  readonly control: Control
  // 每个调用方用独立 Deferred 取得自己的发送结果，底层失败不会终止唯一 sender。
  readonly result: Deferred.Deferred<void, SendError>
}

export type WebSocketConnectionTermination<ConnectionError = unknown> =
  | { readonly _tag: "RemoteClose"; readonly code?: number; readonly reason?: string }
  | { readonly _tag: "LocalClose" }
  | { readonly _tag: "Failure"; readonly error: ConnectionError }

/** 单次连接 epoch 暴露的 raw frame、控制消息发送与终止信号。 */
export interface WebSocketConnection<
  RawFrame = unknown,
  Control = unknown,
  SendError = never,
  ConnectionError = unknown,
> {
  readonly frames: Stream.Stream<RawFrame>
  readonly send: (control: Control) => Effect.Effect<void, SendError>
  readonly termination: Effect.Effect<WebSocketConnectionTermination<ConnectionError>>
  readonly close: Effect.Effect<void>
}

/** 从底层 transport adapter 建立 scoped 连接边界。 */
export const makeWebSocketConnection = <
  RawFrame,
  Control,
  SendError,
  ConnectionError,
  WriteR,
  TerminationR,
  CloseR,
>(options: {
  readonly frames: Stream.Stream<RawFrame>
  readonly write: (control: Control) => Effect.Effect<void, SendError, WriteR>
  readonly awaitTermination: Effect.Effect<
    WebSocketConnectionTermination<ConnectionError>,
    never,
    TerminationR
  >
  readonly close: Effect.Effect<void, never, CloseR>
}): Effect.Effect<
  WebSocketConnection<RawFrame, Control, SendError, ConnectionError>,
  never,
  Scope.Scope | WriteR | TerminationR | CloseR
> =>
  Effect.gen(function* () {
    // 所有控制消息只经过这一条 FIFO Queue，禁止并发调用直接触碰 transport writer。
    const sendQueue = yield* Queue.unbounded<SendRequest<Control, SendError>>()
    // 远端关闭、底层失败和本地关闭竞争同一个一次性信号，首个终止原因获胜。
    const termination = yield* Deferred.make<WebSocketConnectionTermination<ConnectionError>>()
    // close 在连接返回后才执行；构造期捕获环境，避免 adapter 依赖泄漏到公开接口。
    const closeContext = yield* Effect.context<CloseR>()
    yield* Effect.addFinalizer(() => Queue.shutdown(sendQueue))

    // 唯一 scoped sender 串行完成 writer，并把 Exit 交还对应 send 调用方后继续服务。
    yield* Queue.take(sendQueue).pipe(
      Effect.flatMap((request) =>
        options.write(request.control).pipe(
          Effect.exit,
          Effect.flatMap((exit) => Deferred.done(request.result, exit)),
        ),
      ),
      Effect.forever,
      Effect.forkScoped,
    )
    // transport 终止观察也归属连接 Scope，Scope 关闭后不会遗留监听 Fiber。
    yield* options.awaitTermination.pipe(
      Effect.flatMap((reason) => Deferred.succeed(termination, reason)),
      Effect.forkScoped,
    )

    const send: WebSocketConnection<RawFrame, Control, SendError, ConnectionError>["send"] = (
      control,
    ) =>
      Effect.gen(function* () {
        const result = yield* Deferred.make<void, SendError>()
        yield* Queue.offer(sendQueue, { control, result })
        yield* Deferred.await(result)
      })
    const close = Effect.uninterruptible(
      options.close.pipe(
        Effect.provide(closeContext),
        Effect.zipRight(Deferred.succeed(termination, { _tag: "LocalClose" })),
        Effect.asVoid,
      ),
    )
    // 手动 close 与 Scope finalization 共用相同关闭路径和 LocalClose 信号。
    yield* Effect.addFinalizer(() => close)

    return Object.freeze({
      frames: options.frames,
      send,
      termination: Deferred.await(termination),
      close,
    })
  })
