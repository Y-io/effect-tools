import * as Socket from "@effect/platform/Socket"
import { Effect, Either, Option, Schema, Stream } from "effect"
import type { Scope } from "effect"
import type { AnyProtocolDefinition } from "./protocol"
import { makeSubscriptionManager } from "./subscription-manager"
import { makeWebSocketConnection } from "./websocket-connection"

type ProtocolStream<Protocol> = Protocol extends {
  readonly schema: infer MessageSchema extends Schema.Schema.AnyNoContext
  readonly subscription: infer Subscription extends (...args: never[]) => unknown
}
  ? {
      readonly stream: (
        ...args: Parameters<Subscription>
      ) => Stream.Stream<Schema.Schema.Type<MessageSchema>>
    }
  : never

export type SocketClient<Catalog extends Readonly<Record<string, AnyProtocolDefinition>>> = {
  readonly [Key in keyof Catalog]: ProtocolStream<Catalog[Key]>
}

export interface SocketClientOptions<
  Catalog extends Readonly<Record<string, AnyProtocolDefinition>>,
  RawFrame extends string | Uint8Array,
> {
  readonly catalog: Catalog
  readonly socket: Socket.Socket
  readonly parser: (frame: RawFrame) => unknown
}

const reconnectDelay = "3 seconds"

export const makeSocketClient = <
  const Catalog extends Readonly<Record<string, AnyProtocolDefinition>>,
  RawFrame extends string | Uint8Array,
>(
  options: SocketClientOptions<Catalog, RawFrame>,
): Effect.Effect<SocketClient<Catalog>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const manager = yield* makeSubscriptionManager()

    const handleFrame = (frame: string | Uint8Array) =>
      Effect.sync(() => {
        try {
          return Option.some(options.parser(frame as RawFrame))
        } catch {
          return Option.none()
        }
      }).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.void,
            onSome: (parsed) =>
              manager.match(parsed).pipe(
                Effect.flatMap(
                  Option.match({
                    onNone: () => Effect.void,
                    onSome: (target) => {
                      const decoded = Schema.decodeUnknownEither(target.protocol.schema)(parsed)
                      return Either.match(decoded, {
                        onLeft: () => Effect.void,
                        onRight: target.publish,
                      })
                    },
                  }),
                ),
              ),
          }),
        ),
      )

    const runAttempt = Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* makeWebSocketConnection(options.socket)
        yield* Stream.runForEach(connection.frames, handleFrame).pipe(Effect.forkScoped)
        yield* Effect.raceFirst(
          connection.termination,
          manager.runConnection(connection.send),
        ).pipe(Effect.tapError(() => connection.close))
      }),
    )

    yield* runAttempt.pipe(
      Effect.catchAll(() => Effect.void),
      Effect.zipRight(Effect.sleep(reconnectDelay)),
      Effect.forever,
      Effect.forkScoped,
    )

    const client = Object.fromEntries(
      Object.entries(options.catalog).map(([protocolKey, protocol]) => [
        protocolKey,
        {
          stream: (...args: ReadonlyArray<unknown>) =>
            manager.stream(protocolKey, protocol, protocol.subscription(...(args as never[]))),
        },
      ]),
    )

    return client as unknown as SocketClient<Catalog>
  })
