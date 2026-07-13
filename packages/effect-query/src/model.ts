import type { UseQueryOptions } from "@tanstack/react-query"
import { Cause, Context, Data, Effect, Exit, Runtime } from "effect"

export class QueryDefect extends Data.TaggedError("QueryDefect")<{
  readonly cause: unknown
}> {}

export type Json = null | boolean | number | string | ReadonlyArray<Json> | JsonObject

export interface JsonObject {
  readonly [key: string]: Json
}

const EffectQueryOptionsTypeId: unique symbol = Symbol.for("@pkg/effect-query/EffectQueryOptions")

export type EffectQueryKey<Input extends JsonObject> = readonly [name: string, input: Input]

export type QueryEffect<Input extends JsonObject, A, E, R> = (
  input: Input,
) => Effect.Effect<A, E, R>

export type EffectQueryOptions<Input extends JsonObject, A, E, R, Data = A> = Omit<
  UseQueryOptions<A, E | QueryDefect, Data, EffectQueryKey<Input>>,
  "queryFn" | "queryKey"
> & {
  readonly [EffectQueryOptionsTypeId]: typeof EffectQueryOptionsTypeId
  readonly queryKey: EffectQueryKey<Input>
  readonly queryFn: QueryEffect<Input, A, E, R>
}

type HttpApiQueryFunction<Input extends JsonObject, A, E, R, Response> = <
  WithResponse extends boolean = false,
>(
  input: Input & { readonly withResponse?: WithResponse },
) => Effect.Effect<WithResponse extends true ? [A, Response] : A, E, R>

type QueryInputField = "path" | "payload" | "urlParams" | "withResponse"

type SupportedQueryInput<Input extends JsonObject> =
  Exclude<keyof Input, QueryInputField> extends never ? unknown : never

type QueryInput<Input extends JsonObject> = Input extends unknown
  ? Omit<Input, "withResponse">
  : never

type EmptyHttpApiQueryFunction<A, E, R, Response> = <WithResponse extends boolean = false>(
  input: void | { readonly withResponse?: WithResponse },
) => Effect.Effect<WithResponse extends true ? [A, Response] : A, E, R>

export type DescriptorOptions<Key extends string, Input extends JsonObject, A, E, R> = Omit<
  EffectQueryOptions<Input, A, E, R>,
  "queryKey"
> & {
  readonly queryKey: readonly [Key, Input]
}

export type QueryDescriptor<Key extends string, Input extends JsonObject, A, E, R> = {
  readonly key: Key
  readonly options: (input: Input) => DescriptorOptions<Key, Input, A, E, R>
}

export type EmptyQueryDescriptor<Key extends string, A, E, R> = {
  readonly key: Key
  readonly options: () => DescriptorOptions<Key, {}, A, E, R>
}

export function makeEffectQueryOptions<
  Identifier,
  Service,
  A,
  E,
  R,
  Response,
  const Key extends string,
>(
  service: Context.Tag<Identifier, Service>,
  select: (client: Service) => EmptyHttpApiQueryFunction<A, E, R, Response>,
  key: Key,
): EmptyQueryDescriptor<Key, A, E, R | Identifier>
export function makeEffectQueryOptions<
  Identifier,
  Service,
  Input extends JsonObject,
  A,
  E,
  R,
  Response,
  const Key extends string,
>(
  service: Context.Tag<Identifier, Service>,
  select: (client: Service) => HttpApiQueryFunction<Input, A, E, R, Response>,
  key: Key,
): SupportedQueryInput<Input> extends never
  ? never
  : QueryDescriptor<Key, QueryInput<Input>, A, E, R | Identifier>
export function makeEffectQueryOptions<Identifier, Service>(
  service: Context.Tag<Identifier, Service>,
  select: (client: Service) => unknown,
  key: string,
): unknown {
  const options = (request?: unknown) => {
    const input =
      typeof request === "object" && request !== null
        ? {
            ...("path" in request ? { path: request.path } : undefined),
            ...("urlParams" in request ? { urlParams: request.urlParams } : undefined),
            ...("payload" in request ? { payload: request.payload } : undefined),
          }
        : {}

    const queryFn = (endpointRequest: unknown) =>
      Effect.flatMap(service, (client) => {
        const endpoint = select(client) as (
          request: unknown,
        ) => Effect.Effect<unknown, unknown, unknown>
        return endpoint(endpointRequest)
      })

    return {
      [EffectQueryOptionsTypeId]: EffectQueryOptionsTypeId,
      queryKey: [key, input],
      queryFn,
    }
  }

  return { key, options }
}

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
        throw new QueryDefect({ cause: Cause.squash(cause) })
      },
    }),
  )
