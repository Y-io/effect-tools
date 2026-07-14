import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, expect, test } from "bun:test"
import { Context, Effect, Layer, ManagedRuntime } from "effect"
import type { ReactElement } from "react"
import { act, create, type ReactTestRenderer } from "react-test-renderer"
import {
  EffectDefect,
  makeEffectMutationOptions,
  makeEffectRuntime,
} from "../../src/react-query/index"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

type UpdateInput = {
  readonly path: { readonly id: string }
  readonly payload: { readonly name: string }
  readonly headers: { readonly authorization: string }
}

type UpdateEndpoint = <WithResponse extends boolean = false>(
  input: UpdateInput & { readonly withResponse?: WithResponse },
) => Effect.Effect<
  WithResponse extends true ? [string, unknown] : string,
  { readonly _tag: "UpdateFailed" }
>

const TestClient = Context.GenericTag<{
  readonly users: { readonly update: UpdateEndpoint }
}>("@pkg/http-api-client/react-query/test/MutationClient")

type HealthEndpoint = <WithResponse extends boolean = false>(
  input: void | { readonly withResponse?: WithResponse },
) => Effect.Effect<WithResponse extends true ? [string, unknown] : string>

const HealthClient = Context.GenericTag<{
  readonly health: HealthEndpoint
}>("@pkg/http-api-client/react-query/test/HealthClient")

const renderers: Array<ReactTestRenderer> = []
const runtimes: Array<{ readonly dispose: () => Promise<void> }> = []

const unmountAll = () => {
  for (const renderer of renderers.splice(0)) {
    act(() => renderer.unmount())
  }
}

afterEach(async () => {
  unmountAll()
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
  renderers.push(renderer!)
}

test("useEffectMutation 执行 endpoint 并保留 TanStack callbacks", async () => {
  const calls: Array<UpdateInput> = []
  let spanName: string | undefined
  const endpoint: UpdateEndpoint = (input) =>
    Effect.currentSpan.pipe(
      Effect.tap((span) => Effect.sync(() => (spanName = span.name))),
      Effect.tap(() => Effect.sync(() => calls.push(input))),
      Effect.as(`updated:${input.path.id}`),
    )
  const runtime = makeManagedRuntime(Layer.succeed(TestClient, { users: { update: endpoint } }))
  const EffectReact = makeEffectRuntime<Context.Tag.Identifier<typeof TestClient>>()
  const descriptor = makeEffectMutationOptions(
    TestClient,
    (client) => client.users.update,
    "PATCH:users.update",
  )
  const queryClient = new QueryClient()
  const events: Array<string> = []
  let mutateAsync: ((variables: UpdateInput) => Promise<string>) | undefined

  const Probe = () => {
    const mutation = EffectReact.useEffectMutation({
      ...descriptor.options(),
      onMutate: (variables) => {
        events.push(`mutate:${variables.path.id}`)
        return { id: variables.path.id }
      },
      onSuccess: (data, _variables, result) => {
        events.push(`success:${data}:${result.id}`)
      },
    })
    mutateAsync = mutation.mutateAsync
    return null
  }

  await mount(
    <QueryClientProvider client={queryClient}>
      <EffectReact.Provider runtime={runtime}>
        <Probe />
      </EffectReact.Provider>
    </QueryClientProvider>,
  )

  const variables = {
    path: { id: "u-1" },
    payload: { name: "Ada" },
    headers: { authorization: "Bearer token" },
  }
  let result: string | undefined
  await act(async () => {
    result = await mutateAsync!(variables)
  })
  expect(result).toBe("updated:u-1")
  expect(descriptor.key).toBe("PATCH:users.update")
  expect(descriptor.options().mutationKey).toEqual(["PATCH:users.update"])
  expect(spanName).toBe("PATCH:users.update")
  expect(calls).toEqual([variables])
  expect(events).toEqual(["mutate:u-1", "success:updated:u-1:u-1"])
  unmountAll()
  queryClient.clear()
})

test("Provider 缺失时 mutation 通过默认 runtime 失败为 EffectDefect", async () => {
  const EffectReact = makeEffectRuntime<Context.Tag.Identifier<typeof TestClient>>()
  const descriptor = makeEffectMutationOptions(
    TestClient,
    (client) => client.users.update,
    "PATCH:users.update",
  )
  const queryClient = new QueryClient()
  let mutateAsync: ((variables: UpdateInput) => Promise<string>) | undefined

  const Probe = () => {
    mutateAsync = EffectReact.useEffectMutation(descriptor.options()).mutateAsync
    return null
  }

  await mount(
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>,
  )

  let failure: unknown
  await act(async () => {
    try {
      await mutateAsync!({
        path: { id: "u-1" },
        payload: { name: "Ada" },
        headers: { authorization: "Bearer token" },
      })
    } catch (cause) {
      failure = cause
    }
  })
  expect(failure).toBeInstanceOf(EffectDefect)
  unmountAll()
  queryClient.clear()
})

test("无输入 endpoint 允许 mutateAsync()", async () => {
  const endpoint: HealthEndpoint = () => Effect.succeed("healthy")
  const runtime = makeManagedRuntime(Layer.succeed(HealthClient, { health: endpoint }))
  const EffectReact = makeEffectRuntime<Context.Tag.Identifier<typeof HealthClient>>()
  const descriptor = makeEffectMutationOptions(
    HealthClient,
    (client) => client.health,
    "GET:health",
  )
  const queryClient = new QueryClient()
  let mutateAsync: (() => Promise<string>) | undefined

  const Probe = () => {
    mutateAsync = EffectReact.useEffectMutation(descriptor.options()).mutateAsync
    return null
  }

  await mount(
    <QueryClientProvider client={queryClient}>
      <EffectReact.Provider runtime={runtime}>
        <Probe />
      </EffectReact.Provider>
    </QueryClientProvider>,
  )

  let result: string | undefined
  await act(async () => {
    result = await mutateAsync!()
  })
  expect(result).toBe("healthy")
  unmountAll()
  queryClient.clear()
})
