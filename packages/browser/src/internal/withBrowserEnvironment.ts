import { Effect } from "effect"
import { isBrowserEnvironment } from "./isBrowserEnvironment"

export const withBrowserEnvironment = <Value>(options: {
  readonly service: string
  readonly defaultValue: Value
  readonly getValue: () => Value
}): Effect.Effect<{ readonly isBrowser: boolean; readonly value: Value }> =>
  Effect.gen(function* () {
    if (!isBrowserEnvironment()) {
      yield* Effect.logError(
        `${options.service} requires a browser environment; defaulting to ${options.defaultValue}`,
      )
      return { isBrowser: false, value: options.defaultValue }
    }
    const value = yield* Effect.try(options.getValue).pipe(
      Effect.catchAll((error) =>
        Effect.logError(
          `${options.service} failed to read browser value; defaulting to ${options.defaultValue}`,
          error,
        ).pipe(Effect.as(options.defaultValue)),
      ),
    )
    return { isBrowser: true, value }
  })
