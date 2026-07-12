import { Effect, PubSub, Ref, Runtime, Stream, Subscribable } from "effect"

export class NetworkSignal extends Effect.Service<NetworkSignal>()("NetworkSignal", {
  scoped: Effect.gen(function* () {
    const initial = yield* Effect.sync(() => {
      if (typeof window === "undefined" || typeof navigator === "undefined") {
        throw new Error("NetworkSignal requires a browser environment")
      }
      return window.navigator.onLine
    })
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
    const online = () => Runtime.runSync(runtime)(publish(true))
    const offline = () => Runtime.runSync(runtime)(publish(false))

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        window.addEventListener("online", online)
        window.addEventListener("offline", offline)
      }),
      () =>
        Effect.sync(() => {
          window.removeEventListener("online", online)
          window.removeEventListener("offline", offline)
        }),
    )

    return {
      isOnline: Subscribable.make({
        get: Ref.get(current),
        changes: Stream.fromPubSub(updates),
      }),
    }
  }),
}) {}
