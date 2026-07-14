import {
  FetchHttpClient,
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
} from "@effect/platform"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { expect, test } from "bun:test"
import { Effect, ManagedRuntime, Schema } from "effect"
import { act, create, type ReactTestRenderer } from "react-test-renderer"
import { makeEffectQueryOptions, makeEffectQueryRuntime } from "../../src/react-query/index"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

class UserNotFound extends Schema.TaggedClass<UserNotFound>()("UserNotFound", {
  id: Schema.String,
}) {}

const UserResult = Schema.Struct({
  id: Schema.String,
  profile: Schema.Struct({ displayName: Schema.String }),
  view: Schema.String,
})

const lookupEndpoint = HttpApiEndpoint.post("lookup", "/users/:id")
  .setPath(Schema.Struct({ id: Schema.String }))
  .setUrlParams(Schema.Struct({ view: Schema.String }))
  .setPayload(Schema.Struct({ profile: Schema.Struct({ displayName: Schema.String }) }))
  .addSuccess(UserResult)
  .addError(UserNotFound, { status: 404 })

const TestApi = HttpApi.make("test-api").add(HttpApiGroup.make("users").add(lookupEndpoint))

type RequestRecord = {
  readonly method: string
  readonly path: string
  readonly payload: unknown
  readonly view: string | null
}

const waitForQuery = (queryClient: QueryClient) =>
  new Promise<void>((resolve) => {
    const unsubscribe = queryClient.getQueryCache().subscribe(({ query }) => {
      if (query.state.status === "pending") return
      unsubscribe()
      setTimeout(resolve, 0)
    })
  })

test("真实 HttpApiClient Service 通过 useEffectQuery 执行请求与业务错误", async () => {
  const requests: Array<RequestRecord> = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const id = url.pathname.split("/").at(-1) ?? ""
      const payload = await request.json()
      requests.push({
        method: request.method,
        path: url.pathname,
        payload,
        view: url.searchParams.get("view"),
      })

      if (id === "missing") {
        return Response.json({ _tag: "UserNotFound", id }, { status: 404 })
      }

      return Response.json({
        id,
        profile: (payload as { readonly profile: unknown }).profile,
        view: url.searchParams.get("view"),
      })
    },
  })

  class RealApiClient extends Effect.Service<RealApiClient>()("RealApiClient", {
    dependencies: [FetchHttpClient.layer],
    effect: HttpApiClient.make(TestApi, { baseUrl: server.url }),
  }) {}

  const managedRuntime = ManagedRuntime.make(RealApiClient.Default)
  const EffectQuery = makeEffectQueryRuntime(() => managedRuntime.runtime())
  const lookupQuery = makeEffectQueryOptions(
    RealApiClient,
    (client) => client.users.lookup,
    "POST:users.lookup",
  )

  const execute = async (id: string) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const options = lookupQuery.options({
      path: { id },
      payload: { profile: { displayName: "Ada" } },
      urlParams: { view: "full" },
    })
    let snapshot: {
      readonly data: unknown
      readonly error: unknown
      readonly status: string
    } = { data: undefined, error: undefined, status: "pending" }

    const Probe = () => {
      const query = EffectQuery.useEffectQuery(options)
      snapshot = { data: query.data, error: query.error, status: query.status }
      return null
    }

    const settled = waitForQuery(queryClient)
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <EffectQuery.Provider>
            <Probe />
          </EffectQuery.Provider>
        </QueryClientProvider>,
      )
    })
    await act(async () => settled)
    act(() => renderer!.unmount())
    queryClient.clear()
    return { options, snapshot }
  }

  try {
    const success = await execute("u-1")
    expect(success.options.queryKey).toEqual([
      "POST:users.lookup",
      {
        path: { id: "u-1" },
        payload: { profile: { displayName: "Ada" } },
        urlParams: { view: "full" },
      },
    ])
    expect(success.snapshot).toEqual({
      data: { id: "u-1", profile: { displayName: "Ada" }, view: "full" },
      error: null,
      status: "success",
    })

    const failure = await execute("missing")
    expect(failure.snapshot.status).toBe("error")
    expect(failure.snapshot.error).toBeInstanceOf(UserNotFound)
    expect(failure.snapshot.error).toMatchObject({ _tag: "UserNotFound", id: "missing" })

    expect(requests).toEqual([
      {
        method: "POST",
        path: "/users/u-1",
        payload: { profile: { displayName: "Ada" } },
        view: "full",
      },
      {
        method: "POST",
        path: "/users/missing",
        payload: { profile: { displayName: "Ada" } },
        view: "full",
      },
    ])
  } finally {
    await managedRuntime.dispose()
    await server.stop(true)
  }
})
