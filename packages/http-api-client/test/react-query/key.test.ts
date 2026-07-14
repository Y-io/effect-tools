import { expect, test } from "bun:test"
import { Context, Effect } from "effect"
import { makeEffectMutationOptions, makeEffectQueryOptions } from "../../src/react-query/index"

type EmptyEndpoint = <WithResponse extends boolean = false>(
  input: void | { readonly withResponse?: WithResponse },
) => Effect.Effect<WithResponse extends true ? [string, unknown] : string>

const TestClient = Context.GenericTag<{
  readonly endpoint: EmptyEndpoint
}>("@pkg/http-api-client/react-query/test/KeyClient")

const runtimeEmptyKey = "" as "GET:test.dynamic"

test("Query descriptor 在运行时拒绝空字符串 key", () => {
  expect(() =>
    makeEffectQueryOptions(TestClient, (client) => client.endpoint, runtimeEmptyKey),
  ).toThrow("React Query descriptor key must not be empty")
})

test("Mutation descriptor 在运行时拒绝空字符串 key", () => {
  expect(() =>
    makeEffectMutationOptions(TestClient, (client) => client.endpoint, runtimeEmptyKey),
  ).toThrow("React Query descriptor key must not be empty")
})
