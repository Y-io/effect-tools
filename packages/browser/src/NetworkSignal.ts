import { Context, Effect, Layer } from "effect"
import type { Subscribable } from "effect"
import { makeBooleanSignal } from "./internal/makeBooleanSignal"
import { withBrowserEnvironment } from "./internal/withBrowserEnvironment"

export const NetworkSignal = Context.GenericTag<Subscribable.Subscribable<boolean>>("NetworkSignal")

export const makeNetworkSignalLive = (defaultValue = true) =>
  Layer.scoped(
    NetworkSignal,
    Effect.gen(function* () {
      const environment = yield* withBrowserEnvironment({
        service: "NetworkSignal",
        defaultValue,
        getValue: () => window.navigator.onLine,
      })
      return yield* makeBooleanSignal(environment.value, (emit) => {
        if (!environment.isBrowser) {
          return Effect.void
        }
        const online = () => emit(true)
        const offline = () => emit(false)
        return Effect.acquireRelease(
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
      })
    }),
  )
