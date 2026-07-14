import type { UseMutationOptions } from "@tanstack/react-query"
import { Context, Effect } from "effect"
import type { EffectDefect } from "./effect"
import type {
  EmptyHttpApiEndpointFunction,
  EndpointRequest,
  HttpApiEndpointFunction,
} from "./http-api"
import { assertNonEmptyKey, type StaticNonEmptyKey } from "./key"

const EffectMutationOptionsTypeId: unique symbol = Symbol.for(
  "@pkg/http-api-client/react-query/EffectMutationOptions",
)

export type MutationEffect<Variables, A, E, R> = (variables: Variables) => Effect.Effect<A, E, R>

type EffectMutationFields<Variables, A, E, R> = {
  readonly [EffectMutationOptionsTypeId]: typeof EffectMutationOptionsTypeId
  readonly mutationKey: readonly [string]
  readonly mutationFn: MutationEffect<Variables, A, E, R>
}

export type EffectMutationOptions<Variables, A, E, R, OnMutateResult = unknown> = Omit<
  UseMutationOptions<A, E | EffectDefect, Variables, OnMutateResult>,
  "mutationFn" | "mutationKey"
> &
  EffectMutationFields<Variables, A, E, R>

export type MutationDescriptorOptions<Key extends string, Variables, A, E, R> = Omit<
  EffectMutationOptions<Variables, A, E, R>,
  "mutationKey"
> & {
  readonly mutationKey: readonly [Key]
}

export type MutationDescriptor<Key extends string, Variables, A, E, R> = {
  readonly key: Key
  readonly options: () => MutationDescriptorOptions<Key, Variables, A, E, R>
}

export function makeEffectMutation<
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
  key: StaticNonEmptyKey<Key>,
): MutationDescriptor<Key, void, A, E, R | Identifier>
export function makeEffectMutation<
  Identifier,
  Service,
  Input,
  A,
  E,
  R,
  Response,
  const Key extends string,
>(
  service: Context.Tag<Identifier, Service>,
  select: (client: Service) => HttpApiEndpointFunction<Input, A, E, R, Response>,
  key: StaticNonEmptyKey<Key>,
): MutationDescriptor<Key, EndpointRequest<Input>, A, E, R | Identifier>
export function makeEffectMutation<Identifier, Service>(
  service: Context.Tag<Identifier, Service>,
  select: (client: Service) => unknown,
  key: string,
): unknown {
  assertNonEmptyKey(key)

  const mutationFn = (variables: unknown) =>
    Effect.flatMap(service, (client) => {
      const endpoint = select(client) as (
        request: unknown,
      ) => Effect.Effect<unknown, unknown, unknown>
      return endpoint(variables)
    })

  const options = () => ({
    [EffectMutationOptionsTypeId]: EffectMutationOptionsTypeId,
    mutationKey: [key],
    mutationFn,
  })

  return { key, options }
}
