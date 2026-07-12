import { Context, Effect, Layer } from "effect"
import type { Subscribable } from "effect"
import { makeBooleanSignal } from "./internal/makeBooleanSignal"
import { requireBrowserEnvironment } from "./internal/requireBrowserEnvironment"

export const NetworkSignal = Context.GenericTag<Subscribable.Subscribable<boolean>>("NetworkSignal")

export const NetworkSignalLive = Layer.scoped(
  NetworkSignal,
  Effect.gen(function* () {
    const initial = yield* Effect.sync(() => {
      const browser = requireBrowserEnvironment("NetworkSignal", "window", "navigator")
      return browser.window.navigator.onLine
    })
    return yield* makeBooleanSignal(initial, (emit) => {
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
