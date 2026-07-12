import { Context, Effect, Layer } from "effect"
import type { Subscribable } from "effect"
import { makeBooleanSignal } from "./internal/makeBooleanSignal"
import { withBrowserEnvironment } from "./internal/withBrowserEnvironment"

export const PageVisibilitySignal =
  Context.GenericTag<Subscribable.Subscribable<boolean>>("PageVisibilitySignal")

export const makePageVisibilitySignalLive = (defaultValue = true) =>
  Layer.scoped(
    PageVisibilitySignal,
    Effect.gen(function* () {
      const environment = yield* withBrowserEnvironment({
        service: "PageVisibilitySignal",
        defaultValue,
        getValue: () => document.visibilityState === "visible",
      })
      return yield* makeBooleanSignal(environment.value, (emit) => {
        if (!environment.isBrowser) {
          return Effect.void
        }
        const visibilityChange = () => emit(document.visibilityState === "visible")
        return Effect.acquireRelease(
          Effect.sync(() => document.addEventListener("visibilitychange", visibilityChange)),
          () =>
            Effect.sync(() => document.removeEventListener("visibilitychange", visibilityChange)),
        )
      })
    }),
  )
