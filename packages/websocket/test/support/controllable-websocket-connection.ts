import * as Socket from "@effect/platform/Socket"
import { Deferred, Effect, Exit, Option, Queue, Ref } from "effect"
import type { Scope } from "effect"
import { makeWebSocketConnection, type WebSocketConnection } from "../../src/websocket-connection"

type SocketEvent =
  | { readonly _tag: "Frame"; readonly frame: string | Uint8Array }
  | { readonly _tag: "End"; readonly exit: Exit.Exit<void, Socket.SocketError> }

export interface ControllableSocket {
  readonly socket: Socket.Socket
  readonly open: Effect.Effect<void>
  readonly failOpen: (error: Socket.SocketError) => Effect.Effect<void>
  readonly emitFrame: (frame: string | Uint8Array) => Effect.Effect<void>
  readonly takeSent: Effect.Effect<string | Uint8Array>
  readonly pollSent: Effect.Effect<Option.Option<string | Uint8Array>>
  readonly failNextSend: (error: Socket.SocketError) => Effect.Effect<void>
  readonly replyToNextSend: (frame: string | Uint8Array) => Effect.Effect<void>
  readonly disconnect: (code?: number, reason?: string) => Effect.Effect<void>
  readonly runReleased: Effect.Effect<void>
  readonly runCount: Effect.Effect<number>
  readonly readyCount: Effect.Effect<number>
  readonly closeCount: Effect.Effect<number>
}

/** 只在测试中模拟 Effect Socket；生产 connection 仍走唯一的 Socket.Socket seam。 */
export const makeControllableSocket = (): Effect.Effect<ControllableSocket, never, Scope.Scope> =>
  Effect.gen(function* () {
    const opened = yield* Deferred.make<void, Socket.SocketError>()
    const events = yield* Queue.unbounded<SocketEvent>()
    const sent = yield* Queue.unbounded<string | Uint8Array>()
    const nextSendFailure = yield* Ref.make<Option.Option<Socket.SocketError>>(Option.none())
    const nextSendReply = yield* Ref.make<Option.Option<string | Uint8Array>>(Option.none())
    const released = yield* Deferred.make<void>()
    const runs = yield* Ref.make(0)
    const readyRuns = yield* Ref.make(0)
    const running = yield* Ref.make(false)
    const closes = yield* Ref.make(0)
    yield* Effect.addFinalizer(() =>
      Effect.all([Queue.shutdown(events), Queue.shutdown(sent)], { discard: true }),
    )

    const runRaw = <A, E = never, R = never>(
      handler: (frame: string | Uint8Array) => Effect.Effect<A, E, R> | void,
      options?: { readonly onOpen?: Effect.Effect<void> },
    ): Effect.Effect<void, Socket.SocketError | E, R> => {
      const loop: Effect.Effect<void, Socket.SocketError | E, R> = Effect.suspend(() =>
        Queue.take(events).pipe(
          Effect.flatMap((event): Effect.Effect<void, Socket.SocketError | E, R> => {
            if (event["_tag"] === "End") {
              return Exit.match(event.exit, {
                onFailure: Effect.failCause,
                onSuccess: () => Effect.void,
              })
            }
            const result = handler(event.frame)
            return (Effect.isEffect(result) ? Effect.asVoid(result) : Effect.void).pipe(
              Effect.zipRight(loop),
            )
          }),
        ),
      )
      return Ref.set(running, true).pipe(
        Effect.zipRight(Ref.update(runs, (count) => count + 1)),
        Effect.zipRight(Deferred.await(opened)),
        Effect.zipRight(options?.onOpen ?? Effect.void),
        Effect.zipRight(Ref.update(readyRuns, (count) => count + 1)),
        Effect.zipRight(loop),
        Effect.ensuring(
          Ref.set(running, false).pipe(Effect.zipRight(Deferred.succeed(released, undefined))),
        ),
      )
    }
    const run: Socket.Socket["run"] = (handler, options) =>
      runRaw(
        (frame) => handler(typeof frame === "string" ? new TextEncoder().encode(frame) : frame),
        options,
      )
    const writer: Socket.Socket["writer"] = Effect.succeed((control) =>
      Ref.getAndSet(nextSendFailure, Option.none()).pipe(
        Effect.flatMap(
          Option.match({
            onSome: Effect.fail,
            onNone: () =>
              control instanceof Socket.CloseEvent
                ? Ref.update(closes, (count) => count + 1).pipe(
                    Effect.zipRight(
                      Ref.get(running).pipe(
                        Effect.flatMap((isRunning) =>
                          isRunning
                            ? Queue.offer(events, { _tag: "End", exit: Exit.void })
                            : Effect.void,
                        ),
                      ),
                    ),
                    Effect.asVoid,
                  )
                : Queue.offer(sent, control).pipe(
                    Effect.zipRight(
                      Ref.getAndSet(nextSendReply, Option.none()).pipe(
                        Effect.flatMap(
                          Option.match({
                            onNone: () => Effect.void,
                            onSome: (frame) =>
                              Queue.offer(events, { _tag: "Frame", frame }).pipe(Effect.asVoid),
                          }),
                        ),
                      ),
                    ),
                    Effect.asVoid,
                  ),
          }),
        ),
      ),
    )
    const socket = Socket.Socket.of({
      [Socket.TypeId]: Socket.TypeId,
      run,
      runRaw,
      writer,
    })

    return {
      socket,
      open: Deferred.succeed(opened, undefined).pipe(Effect.asVoid),
      failOpen: (error) => Deferred.fail(opened, error).pipe(Effect.asVoid),
      emitFrame: (frame) => Queue.offer(events, { _tag: "Frame", frame }).pipe(Effect.asVoid),
      takeSent: Queue.take(sent),
      pollSent: Queue.poll(sent),
      failNextSend: (error) => Ref.set(nextSendFailure, Option.some(error)),
      replyToNextSend: (frame) => Ref.set(nextSendReply, Option.some(frame)),
      disconnect: (code = 1000, reason) =>
        Queue.offer(events, {
          _tag: "End",
          exit: Exit.fail(
            new Socket.SocketCloseError({ reason: "Close", code, closeReason: reason }),
          ),
        }).pipe(Effect.asVoid),
      runReleased: Deferred.await(released),
      runCount: Ref.get(runs),
      readyCount: Ref.get(readyRuns),
      closeCount: Ref.get(closes),
    }
  })

export const makeControllableWebSocketConnection = (): Effect.Effect<
  ControllableSocket & { readonly connection: WebSocketConnection },
  Socket.SocketError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const control = yield* makeControllableSocket()
    yield* control.open
    const connection = yield* makeWebSocketConnection(control.socket)
    return { ...control, connection }
  })
