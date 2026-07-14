import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, describe, expect, test } from "bun:test"
import { Context, Effect, Runtime } from "effect"
import { createElement, type ReactElement } from "react"
import { act, create, type ReactTestRenderer } from "react-test-renderer"
import { renderToString } from "react-dom/server"
import {
  makeEffectQueryRuntime,
  makeEffectQueryOptions,
  EffectDefect,
  type EffectRuntimeLoader,
} from "../../src/react-query/index"

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<ReactTestRenderer> = []

afterEach(() => {
  for (const renderer of mounted.splice(0)) {
    act(() => renderer.unmount())
  }
})

const mount = async (node: ReactElement) => {
  let renderer: ReactTestRenderer
  await act(async () => {
    renderer = create(node)
  })
  mounted.push(renderer!)
  return renderer!
}

type EmptyEndpoint<A, E> = <WithResponse extends boolean = false>(
  input: void | { readonly withResponse?: WithResponse },
) => Effect.Effect<WithResponse extends true ? [A, unknown] : A, E>

const makeQueryHarness = <A, E>(effect: () => Effect.Effect<A, E>) => {
  const endpoint = (() => effect()) as EmptyEndpoint<A, E>
  const TestClient = Context.GenericTag<{
    readonly test: { readonly execute: EmptyEndpoint<A, E> }
  }>("@pkg/http-api-client/react-query/test/TestClient")
  const runtime = Runtime.defaultRuntime.pipe(
    Runtime.provideService(TestClient, { test: { execute: endpoint } }),
  )
  const descriptor = makeEffectQueryOptions(
    TestClient,
    (client) => client.test.execute,
    "GET:test.execute",
  )

  return { descriptor, runtime }
}

const waitForStatus = (queryClient: QueryClient, status: "success") =>
  new Promise<void>((resolve) => {
    const unsubscribe = queryClient.getQueryCache().subscribe(({ query }) => {
      if (query.state.status !== status) return
      unsubscribe()
      setTimeout(resolve, 0)
    })
  })

describe("makeEffectQueryRuntime", () => {
  test("Provider SSR render 时不执行 runtime loader", () => {
    let calls = 0
    const loader: EffectRuntimeLoader<never> = () => {
      calls += 1
      return Runtime.defaultRuntime
    }
    const EffectQuery = makeEffectQueryRuntime(loader)

    const html = renderToString(
      <EffectQuery.Provider>
        <main>SSR</main>
      </EffectQuery.Provider>,
    )

    expect(html).toContain("SSR")
    expect(calls).toBe(0)
  })

  test("useRunner 没有 loader 时使用 Runtime.defaultRuntime", async () => {
    const EffectQuery = makeEffectQueryRuntime(() => Runtime.defaultRuntime)
    let run: ReturnType<typeof EffectQuery.useRunner> | undefined

    const Capture = () => {
      run = EffectQuery.useRunner()
      return null
    }

    await mount(createElement(Capture))
    expect(await run!(Effect.succeed("default-runtime"))).toBe("default-runtime")
  })

  test("useRunner 等待 loader，loader 失败包装为 EffectDefect", async () => {
    const loaderError = new Error("runtime failed")
    const EffectQuery = makeEffectQueryRuntime(() => Promise.reject(loaderError))
    let run: ReturnType<typeof EffectQuery.useRunner> | undefined

    const Capture = () => {
      run = EffectQuery.useRunner()
      return null
    }

    await mount(createElement(EffectQuery.Provider, null, createElement(Capture)))

    await expect(run!(Effect.succeed("unused"))).rejects.toEqual(
      new EffectDefect({ cause: loaderError }),
    )
  })

  test("useEffectQuery 没有 loader 时保持 idle 且不执行 queryFn", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let executions = 0
    let fetchStatus: string | undefined
    const { descriptor, runtime } = makeQueryHarness(() => {
      executions += 1
      return Effect.succeed("unexpected")
    })
    const EffectQuery = makeEffectQueryRuntime(() => runtime)
    const options = descriptor.options()

    const Probe = () => {
      fetchStatus = EffectQuery.useEffectQuery(options).fetchStatus
      return null
    }

    await mount(createElement(QueryClientProvider, { client: queryClient }, createElement(Probe)))

    expect(fetchStatus).toBe("idle")
    expect(executions).toBe(0)
    queryClient.clear()
  })

  test("useEffectQuery 有 loader 时使用 query key span 执行 Effect", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let loaderCalls = 0
    let value: string | undefined
    let spanName: string | undefined
    const { descriptor, runtime } = makeQueryHarness(() =>
      Effect.currentSpan.pipe(
        Effect.tap((span) => Effect.sync(() => (spanName = span.name))),
        Effect.as("executed"),
      ),
    )
    const options = descriptor.options()

    const Probe = () => {
      value = EffectQuery.useEffectQuery(options).data
      return null
    }

    const loader = (() => {
      loaderCalls += 1
      return runtime
    }) satisfies EffectRuntimeLoader<typeof runtime extends Runtime.Runtime<infer R> ? R : never>
    const EffectQuery = makeEffectQueryRuntime(loader)
    const settled = waitForStatus(queryClient, "success")

    await mount(
      <QueryClientProvider client={queryClient}>
        <EffectQuery.Provider>
          <Probe />
        </EffectQuery.Provider>
      </QueryClientProvider>,
    )

    await act(async () => settled)

    expect(value).toBe("executed")
    expect(spanName).toBe("GET:test.execute")
    expect(loaderCalls).toBe(1)
    queryClient.clear()
  })

  test("useEffectQuery 保留 TanStack Query retry 行为", async () => {
    const queryClient = new QueryClient()
    let attempts = 0
    let value: string | undefined
    const { descriptor, runtime } = makeQueryHarness(() => {
      attempts += 1
      return attempts === 1 ? Effect.fail("retryable") : Effect.succeed("retried")
    })
    const EffectQuery = makeEffectQueryRuntime(() => runtime)
    const options = {
      ...descriptor.options(),
      retry: 1,
      retryDelay: 0,
    }
    const settled = waitForStatus(queryClient, "success")

    const Probe = () => {
      value = EffectQuery.useEffectQuery(options).data
      return null
    }

    await mount(
      <QueryClientProvider client={queryClient}>
        <EffectQuery.Provider>
          <Probe />
        </EffectQuery.Provider>
      </QueryClientProvider>,
    )
    await act(async () => settled)

    expect(attempts).toBe(2)
    expect(value).toBe("retried")
    queryClient.clear()
  })
})
