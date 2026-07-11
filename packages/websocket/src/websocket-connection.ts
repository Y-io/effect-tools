import * as Socket from "@effect/platform/Socket"
import { Cause, Deferred, Effect, Exit, Fiber, Option, Queue, Ref, Stream } from "effect"
import type { Scope } from "effect"

/** 一个已经 open、终止后不可复用的 Effect Socket connection epoch。 */
export interface WebSocketConnection {
  readonly frames: Stream.Stream<string | Uint8Array>
  readonly send: (control: string | Uint8Array) => Effect.Effect<void, Socket.SocketError>
  readonly termination: Effect.Effect<void>
  readonly close: Effect.Effect<void>
}

const openFailure = (cause: unknown) => new Socket.SocketGenericError({ reason: "Open", cause })

/** 基于 Effect Socket 创建单次 connection epoch；真实 open 前不会返回。 */
export const makeWebSocketConnection = (
  socket: Socket.Socket,
): Effect.Effect<WebSocketConnection, Socket.SocketError, Scope.Scope> =>
  Effect.gen(function* () {
    const frames = yield* Queue.unbounded<string | Uint8Array>()
    const opened = yield* Deferred.make<void, Socket.SocketError>()
    const termination = yield* Deferred.make<void>()
    const closeRequested = yield* Ref.make(false)
    const active = yield* Ref.make(true)
    const writer = yield* socket.writer
    const sendSemaphore = yield* Effect.makeSemaphore(1)

    /** runRaw 完成时先释放 epoch 资源，再向构造方或外部报告结果。 */
    const finish = (exit: Exit.Exit<void, Socket.SocketError>) =>
      Effect.gen(function* () {
        yield* Ref.set(active, false)
        yield* Queue.shutdown(frames)

        if (!(yield* Deferred.isDone(opened))) {
          const error = Exit.match(exit, {
            onFailure: (cause) =>
              Option.getOrElse(Cause.failureOption(cause), () => openFailure(cause)),
            onSuccess: () => openFailure("socket terminated before open"),
          })
          yield* Deferred.fail(opened, error)
        }
        yield* Deferred.succeed(termination, undefined)
      })

    const runFiber = yield* socket
      .runRaw((frame) => Queue.offer(frames, frame), {
        onOpen: Deferred.succeed(opened, undefined).pipe(Effect.asVoid),
      })
      .pipe(Effect.onExit(finish), Effect.forkScoped)

    yield* Deferred.await(opened)

    const close = Ref.getAndSet(closeRequested, true).pipe(
      Effect.flatMap((alreadyRequested) =>
        alreadyRequested
          ? Effect.void
          : writer(new Socket.CloseEvent()).pipe(
              Effect.catchAll(() => Fiber.interrupt(runFiber).pipe(Effect.asVoid)),
            ),
      ),
      Effect.asVoid,
    )
    yield* Effect.addFinalizer(() => close)

    const send: WebSocketConnection["send"] = (control) =>
      sendSemaphore.withPermits(1)(
        Ref.get(active).pipe(
          Effect.flatMap((isActive) =>
            isActive
              ? writer(control)
              : Effect.fail(
                  new Socket.SocketGenericError({
                    reason: "Write",
                    cause: "connection epoch has terminated",
                  }),
                ),
          ),
          Effect.tapError(() =>
            Fiber.interrupt(runFiber).pipe(Effect.zipRight(Deferred.await(termination))),
          ),
        ),
      )

    return {
      frames: Stream.fromQueue(frames),
      send,
      termination: Deferred.await(termination),
      close,
    }
  })
