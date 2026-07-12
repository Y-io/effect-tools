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
    return {
      isBrowser: true,
      value: yield* Effect.sync(options.getValue),
    }
  })
