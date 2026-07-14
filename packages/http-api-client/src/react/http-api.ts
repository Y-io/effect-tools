import type { Effect } from "effect"

export type HttpApiEndpointFunction<Input, A, E, R, Response> = <
  WithResponse extends boolean = false,
>(
  input: Input & { readonly withResponse?: WithResponse },
) => Effect.Effect<WithResponse extends true ? [A, Response] : A, E, R>

export type EmptyHttpApiEndpointFunction<A, E, R, Response> = <
  WithResponse extends boolean = false,
>(
  input: void | { readonly withResponse?: WithResponse },
) => Effect.Effect<WithResponse extends true ? [A, Response] : A, E, R>

export type EndpointRequest<Input> = Input extends unknown ? Omit<Input, "withResponse"> : never
