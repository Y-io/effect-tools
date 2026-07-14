import type { UseQueryOptions } from "@tanstack/react-query"
import { Context, Effect } from "effect"
import type { EffectDefect } from "./effect"
import type {
  EmptyHttpApiEndpointFunction,
  EndpointRequest,
  HttpApiEndpointFunction,
} from "./http-api"
import { assertNonEmptyKey, type NonEmptyKey } from "./key"

export type Json = null | boolean | number | string | ReadonlyArray<Json> | JsonObject

export interface JsonObject {
  readonly [key: string]: Json
}

const EffectQueryOptionsTypeId: unique symbol = Symbol.for(
  "@pkg/http-api-client/react-query/EffectQueryOptions",
)

export type EffectQueryKey<Input extends JsonObject> = readonly [name: string, input: Input]

export type QueryEffect<Input extends JsonObject, A, E, R> = (
  input: Input,
) => Effect.Effect<A, E, R>

export type EffectQueryOptions<Input extends JsonObject, A, E, R, Data = A> = Omit<
  UseQueryOptions<A, E | EffectDefect, Data, EffectQueryKey<Input>>,
  "queryFn" | "queryKey"
> & {
  readonly [EffectQueryOptionsTypeId]: typeof EffectQueryOptionsTypeId
  readonly queryKey: EffectQueryKey<Input>
  readonly queryFn: QueryEffect<Input, A, E, R>
}

type QueryInputField = "path" | "payload" | "urlParams" | "withResponse"

type SupportedQueryInput<Input extends JsonObject> =
  Exclude<keyof Input, QueryInputField> extends never ? unknown : never

type QueryInput<Input extends JsonObject> = EndpointRequest<Input>

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
  select: (client: Service) => EmptyHttpApiEndpointFunction<A, E, R, Response>,
  key: NonEmptyKey<Key>,
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
  select: (client: Service) => HttpApiEndpointFunction<Input, A, E, R, Response>,
  key: NonEmptyKey<Key>,
): SupportedQueryInput<Input> extends never
  ? never
  : QueryDescriptor<Key, QueryInput<Input>, A, E, R | Identifier>
export function makeEffectQueryOptions<Identifier, Service>(
  service: Context.Tag<Identifier, Service>,
  select: (client: Service) => unknown,
  key: string,
): unknown {
  assertNonEmptyKey(key)

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
