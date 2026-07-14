import {
  skipToken,
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query"
import { Cause, Effect, Runtime } from "effect"
import { createContext, createElement, useCallback, useContext, type ReactNode } from "react"
import { EffectDefect, runEffect, type EffectRuntimeHandle } from "./effect"
import type { EffectMutationOptions } from "./mutation"
import type { EffectQueryOptions, JsonObject } from "./query"

export const makeEffectRuntime = <R>() => {
  const RuntimeContext = createContext<EffectRuntimeHandle<R> | undefined>(undefined)

  const Provider = ({
    children,
    runtime,
  }: {
    readonly children?: ReactNode
    readonly runtime?: EffectRuntimeHandle<R>
  }) => createElement(RuntimeContext.Provider, { value: runtime }, children)

  const useRuntime = (): EffectRuntimeHandle<R> | undefined => useContext(RuntimeContext)

  const useRunner = () => {
    const activeRuntime = useRuntime()

    return useCallback(
      async <A, E, EffectR extends R>(
        effect: Effect.Effect<A, E, EffectR>,
        options?: { readonly signal?: AbortSignal },
      ): Promise<A> => {
        let runtime: Runtime.Runtime<EffectR>
        try {
          runtime =
            activeRuntime === undefined
              ? (Runtime.defaultRuntime as Runtime.Runtime<EffectR>)
              : ((await activeRuntime.runtime()) as Runtime.Runtime<EffectR>)
        } catch (cause) {
          throw new EffectDefect({
            cause: Runtime.isFiberFailure(cause)
              ? Cause.squash(cause[Runtime.FiberFailureCauseId])
              : cause,
          })
        }

        return runEffect(runtime, effect, options)
      },
      [activeRuntime],
    )
  }

  const useEffectQuery = <Input extends JsonObject, A, E, EffectR extends R, Data = A>(
    options: EffectQueryOptions<Input, A, E, EffectR, Data>,
  ): UseQueryResult<Data, E | EffectDefect> => {
    const activeRuntime = useRuntime()
    const run = useRunner()
    const { queryFn, ...tanStackOptions } = options

    return useQuery({
      ...tanStackOptions,
      queryFn:
        activeRuntime === undefined
          ? skipToken
          : ({ queryKey, signal }) => {
              return run(queryFn(queryKey[1] as Input).pipe(Effect.withSpan(queryKey[0])), {
                signal,
              })
            },
    })
  }

  const useEffectMutation = <Variables, A, E, EffectR extends R, OnMutateResult = unknown>(
    options: EffectMutationOptions<Variables, A, E, EffectR, OnMutateResult>,
  ): UseMutationResult<A, E | EffectDefect, Variables, OnMutateResult> => {
    const run = useRunner()
    const { mutationFn, mutationKey, ...tanStackOptions } = options

    return useMutation({
      ...tanStackOptions,
      mutationKey,
      mutationFn: (variables) => run(mutationFn(variables).pipe(Effect.withSpan(mutationKey[0]))),
    })
  }

  return { Provider, useEffectMutation, useEffectQuery, useRunner, useRuntime } as const
}
