import { Effect } from "effect"
import { makeEffectQueryOptions } from "@pkg/effect-query"

type EmptyEndpoint<A> = <WithResponse extends boolean = false>(
  request: void | { readonly withResponse?: WithResponse },
) => Effect.Effect<WithResponse extends true ? [A, unknown] : A>

const clientOnlyEndpoint = (() =>
  Effect.sync(() => {
    if (typeof window === "undefined") {
      throw new Error("client-only query executed during SSR")
    }
    return "client-runtime"
  })) as EmptyEndpoint<string>

export class PrototypeClient extends Effect.Service<PrototypeClient>()("PrototypeClient", {
  succeed: { test: { clientOnly: clientOnlyEndpoint } },
}) {}

export const clientOnlyQuery = makeEffectQueryOptions(
  PrototypeClient,
  (client) => client.test.clientOnly,
  "GET:prototype.client-only",
)
