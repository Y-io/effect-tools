import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, describe, expect, test } from "bun:test"
import { Context, Effect, Layer, ManagedRuntime } from "effect"
import { createElement, type ReactElement } from "react"
import { act, create, type ReactTestRenderer } from "react-test-renderer"
import { renderToString } from "react-dom/server"
import {
  makeEffectReactRuntime,
  makeEffectQueryOptions,
  EffectDefect,
} from "../../src/react-query/index"

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<ReactTestRenderer> = []
const runtimes: Array<{ readonly dispose: () => Promise<void> }> = []

afterEach(async () => {
  for (const renderer of mounted.splice(0)) {
    act(() => renderer.unmount())
  }
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
})

const makeManagedRuntime = <R, E>(layer: Layer.Layer<R, E, never>) => {
  const runtime = ManagedRuntime.make(layer)
  runtimes.push(runtime)
  return runtime
}

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
  type TestService = {
    readonly test: { readonly execute: EmptyEndpoint<A, E> }
  }
  const endpoint = (() => effect()) as EmptyEndpoint<A, E>
  const TestClient = Context.GenericTag<TestService>(
    "@pkg/http-api-client/react-query/test/TestClient",
  )
  const runtime = makeManagedRuntime(Layer.succeed(TestClient, { test: { execute: endpoint } }))
  const EffectReact = makeEffectReactRuntime<TestService>()
  const descriptor = makeEffectQueryOptions(
    TestClient,
    (client) => client.test.execute,
    "GET:test.execute",
  )

  return { descriptor, EffectReact, runtime }
}

const waitForStatus = (queryClient: QueryClient, status: "success") =>
  new Promise<void>((resolve) => {
    const unsubscribe = queryClient.getQueryCache().subscribe(({ query }) => {
      if (query.state.status !== status) return
      unsubscribe()
      setTimeout(resolve, 0)
    })
  })

describe("makeEffectReactRuntime", () => {
  test("Provider SSR render 时不构建 ManagedRuntime", async () => {
    let calls = 0
    const runtime = makeManagedRuntime(Layer.effectDiscard(Effect.sync(() => (calls += 1))))
    const EffectReact = makeEffectReactRuntime<never>()

    const html = renderToString(
      <EffectReact.Provider runtime={runtime}>
        <main>SSR</main>
      </EffectReact.Provider>,
    )

    expect(html).toContain("SSR")
    expect(calls).toBe(0)
  })

  test("useRunner 没有 runtime 时使用 Runtime.defaultRuntime", async () => {
    const EffectReact = makeEffectReactRuntime<never>()
    let run: ReturnType<typeof EffectReact.useRunner> | undefined

    const Capture = () => {
      run = EffectReact.useRunner()
      return null
    }

    await mount(createElement(Capture))
    expect(await run!(Effect.succeed("default-runtime"))).toBe("default-runtime")
  })

  test("useRunner 等待 ManagedRuntime 构建，构建失败包装为 EffectDefect", async () => {
    const loaderError = new Error("runtime failed")
    const runtime = makeManagedRuntime(Layer.fail(loaderError))
    const EffectReact = makeEffectReactRuntime<never>()
    let run: ReturnType<typeof EffectReact.useRunner> | undefined

    const Capture = () => {
      run = EffectReact.useRunner()
      return null
    }

    await mount(createElement(EffectReact.Provider, { runtime }, createElement(Capture)))

    await expect(run!(Effect.succeed("unused"))).rejects.toEqual(
      new EffectDefect({ cause: loaderError }),
    )
  })

  test("useEffectQuery 没有 runtime 时保持 idle 且不执行 queryFn", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let executions = 0
    let fetchStatus: string | undefined
    const { descriptor, EffectReact } = makeQueryHarness(() => {
      executions += 1
      return Effect.succeed("unexpected")
    })
    const options = descriptor.options()

    const Probe = () => {
      fetchStatus = EffectReact.useEffectQuery(options).fetchStatus
      return null
    }

    await mount(createElement(QueryClientProvider, { client: queryClient }, createElement(Probe)))

    expect(fetchStatus).toBe("idle")
    expect(executions).toBe(0)
    queryClient.clear()
  })

  test("useEffectQuery 有 runtime 时使用 query key span 执行 Effect", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let value: string | undefined
    let spanName: string | undefined
    const { descriptor, EffectReact, runtime } = makeQueryHarness(() =>
      Effect.currentSpan.pipe(
        Effect.tap((span) => Effect.sync(() => (spanName = span.name))),
        Effect.as("executed"),
      ),
    )
    const options = descriptor.options()

    const Probe = () => {
      value = EffectReact.useEffectQuery(options).data
      return null
    }

    const settled = waitForStatus(queryClient, "success")

    await mount(
      <QueryClientProvider client={queryClient}>
        <EffectReact.Provider runtime={runtime}>
          <Probe />
        </EffectReact.Provider>
      </QueryClientProvider>,
    )

    await act(async () => settled)

    expect(value).toBe("executed")
    expect(spanName).toBe("GET:test.execute")
    queryClient.clear()
  })

  test("useEffectQuery 保留 TanStack Query retry 行为", async () => {
    const queryClient = new QueryClient()
    let attempts = 0
    let value: string | undefined
    const { descriptor, EffectReact, runtime } = makeQueryHarness(() => {
      attempts += 1
      return attempts === 1 ? Effect.fail("retryable") : Effect.succeed("retried")
    })
    const options = {
      ...descriptor.options(),
      retry: 1,
      retryDelay: 0,
    }
    const settled = waitForStatus(queryClient, "success")

    const Probe = () => {
      value = EffectReact.useEffectQuery(options).data
      return null
    }

    await mount(
      <QueryClientProvider client={queryClient}>
        <EffectReact.Provider runtime={runtime}>
          <Probe />
        </EffectReact.Provider>
      </QueryClientProvider>,
    )
    await act(async () => settled)

    expect(attempts).toBe(2)
    expect(value).toBe("retried")
    queryClient.clear()
  })

  test("Provider 从缺失 runtime 切换为可用 runtime 后启动 query", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let executions = 0
    let value: string | undefined
    const { descriptor, EffectReact, runtime } = makeQueryHarness(() => {
      executions += 1
      return Effect.succeed("hydrated")
    })

    const Probe = () => {
      value = EffectReact.useEffectQuery(descriptor.options()).data
      return null
    }
    const tree = (activeRuntime?: typeof runtime) => (
      <QueryClientProvider client={queryClient}>
        <EffectReact.Provider runtime={activeRuntime}>
          <Probe />
        </EffectReact.Provider>
      </QueryClientProvider>
    )

    const renderer = await mount(tree())
    expect(executions).toBe(0)

    const settled = waitForStatus(queryClient, "success")
    await act(async () => renderer.update(tree(runtime)))
    await act(async () => settled)

    expect(executions).toBe(1)
    expect(value).toBe("hydrated")
    queryClient.clear()
  })
})
