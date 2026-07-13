import { skipToken, useQuery, type UseQueryResult } from "@tanstack/react-query"
import { Runtime, type Effect } from "effect"
import { createContext, createElement, useCallback, useContext, type ReactNode } from "react"
import { QueryDefect, runEffect, type EffectQueryOptions, type JsonObject } from "./model"

export type EffectRuntimeLoader<R> = () => Runtime.Runtime<R> | PromiseLike<Runtime.Runtime<R>>

export const makeEffectQueryRuntime = <R>(runtimeLoader: EffectRuntimeLoader<R>) => {
  const RuntimeEnabledContext = createContext(false)

  const Provider = ({
    children,
    enabled = true,
  }: {
    readonly children?: ReactNode
    readonly enabled?: boolean
  }) => createElement(RuntimeEnabledContext.Provider, { value: enabled }, children)

  const useRuntime = (): EffectRuntimeLoader<R> | undefined =>
    useContext(RuntimeEnabledContext) ? runtimeLoader : undefined

  const useRunner = () => {
    const activeRuntimeLoader = useRuntime()

    return useCallback(
      async <A, E, EffectR extends R>(
        effect: Effect.Effect<A, E, EffectR>,
        options?: { readonly signal?: AbortSignal },
      ): Promise<A> => {
        let runtime: Runtime.Runtime<EffectR>
        try {
          runtime =
            activeRuntimeLoader === undefined
              ? (Runtime.defaultRuntime as Runtime.Runtime<EffectR>)
              : ((await activeRuntimeLoader()) as Runtime.Runtime<EffectR>)
        } catch (cause) {
          throw new QueryDefect({ cause })
        }

        return runEffect(runtime, effect, options)
      },
      [activeRuntimeLoader],
    )
  }

  const useEffectQuery = <Input extends JsonObject, A, E, EffectR extends R, Data = A>(
    options: EffectQueryOptions<Input, A, E, EffectR, Data>,
  ): UseQueryResult<Data, E | QueryDefect> => {
    const activeRuntimeLoader = useRuntime()
    const run = useRunner()
    const { queryFn, ...tanStackOptions } = options

    return useQuery({
      ...tanStackOptions,
      queryFn:
        activeRuntimeLoader === undefined
          ? skipToken
          : ({ queryKey, signal }) => {
              return run(queryFn(queryKey[1] as Input), { signal })
            },
    })
  }

  return { Provider, useEffectQuery, useRunner, useRuntime } as const
}
