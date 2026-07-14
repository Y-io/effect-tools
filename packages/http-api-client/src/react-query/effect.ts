import { Cause, Data, Effect, Exit, Runtime } from "effect"

export class EffectDefect extends Data.TaggedError("EffectDefect")<{
  readonly cause: unknown
}> {}

export type EffectRuntimeLoader<R> = () => Runtime.Runtime<R> | PromiseLike<Runtime.Runtime<R>>

export const runEffect = <A, E, R>(
  runtime: Runtime.Runtime<R>,
  effect: Effect.Effect<A, E, R>,
  options?: { readonly signal?: AbortSignal },
): Promise<A> =>
  Runtime.runPromiseExit(runtime, effect, options).then(
    Exit.match({
      onSuccess: (value) => value,
      onFailure: (cause) => {
        if (Cause.isFailType(cause)) {
          throw cause.error
        }
        throw new EffectDefect({ cause: Cause.squash(cause) })
      },
    }),
  )
