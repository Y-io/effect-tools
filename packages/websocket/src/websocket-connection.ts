import { Deferred, Effect, Queue } from "effect"
import type { Scope, Stream } from "effect"

interface SendRequest<Control, SendError> {
  readonly control: Control
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
    const sendQueue = yield* Queue.unbounded<SendRequest<Control, SendError>>()
    const termination = yield* Deferred.make<WebSocketConnectionTermination<ConnectionError>>()
    const closeContext = yield* Effect.context<CloseR>()
    yield* Effect.addFinalizer(() => Queue.shutdown(sendQueue))

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

    return Object.freeze({
      frames: options.frames,
      send,
      termination: Deferred.await(termination),
      close,
    })
  })
