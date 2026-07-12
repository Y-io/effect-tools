import { Effect, PubSub, Ref, Runtime, Scope, Stream, Subscribable } from "effect"

export const makeBooleanSignal = (
  initial: boolean,
  listen: (emit: (value: boolean) => void) => Effect.Effect<void, never, Scope.Scope>,
): Effect.Effect<Subscribable.Subscribable<boolean>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const current = yield* Ref.make(initial)
    const updates = yield* PubSub.sliding<boolean>({ capacity: 1, replay: 1 })
    yield* PubSub.publish(updates, initial)
    yield* Effect.addFinalizer(() => PubSub.shutdown(updates))
    const runtime = yield* Effect.runtime<never>()

    const publish = (value: boolean) =>
      Ref.modify(current, (previous) =>
        previous === value ? ([false, previous] as const) : ([true, value] as const),
      ).pipe(
        Effect.flatMap((changed) =>
          changed ? PubSub.publish(updates, value) : Effect.succeed(false),
        ),
        Effect.asVoid,
      )
    const emit = (value: boolean) => Runtime.runSync(runtime)(publish(value))

    yield* listen(emit)

    return Subscribable.make({
      get: Ref.get(current),
      changes: Stream.fromPubSub(updates),
    })
  })
