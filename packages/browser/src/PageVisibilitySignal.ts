import { Context, Effect, Layer } from "effect"
import type { Subscribable } from "effect"
import { isBrowserEnvironment } from "./internal/isBrowserEnvironment"
import { makeBooleanSignal } from "./internal/makeBooleanSignal"

export const PageVisibilitySignal =
  Context.GenericTag<Subscribable.Subscribable<boolean>>("PageVisibilitySignal")

export const PageVisibilitySignalLive = Layer.scoped(
  PageVisibilitySignal,
  Effect.gen(function* () {
    const initial = yield* Effect.sync(() => {
      if (!isBrowserEnvironment()) {
        throw new Error("PageVisibilitySignal requires a browser environment")
      }
      return document.visibilityState === "visible"
    })

    return yield* makeBooleanSignal(initial, (emit) => {
      const visibilityChange = () => emit(document.visibilityState === "visible")
      return Effect.acquireRelease(
        Effect.sync(() => document.addEventListener("visibilitychange", visibilityChange)),
        () => Effect.sync(() => document.removeEventListener("visibilitychange", visibilityChange)),
      )
    })
  }),
)
