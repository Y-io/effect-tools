import { Context, Effect, Layer, ManagedRuntime } from "effect"
import { makeEffectRuntime, type EffectRuntimeHandle } from "../../src/react-query/index"

class AvailableService extends Context.Tag("AvailableService")<
  AvailableService,
  { readonly value: string }
>() {}

class MissingService extends Context.Tag("MissingService")<
  MissingService,
  { readonly value: string }
>() {}

const runtime = ManagedRuntime.make(Layer.succeed(AvailableService, { value: "available" }))
const missingRuntime = ManagedRuntime.make(Layer.succeed(MissingService, { value: "missing" }))
const EffectReact = makeEffectRuntime<AvailableService>()
type ProviderProps = Parameters<typeof EffectReact.Provider>[0]

const providerProps: ProviderProps = { runtime }
// @ts-expect-error Provider runtime 必须包含 makeEffectRuntime 声明的 Service
const missingProviderProps: ProviderProps = { runtime: missingRuntime }

const RuntimeTypeProbe = () => {
  const activeRuntime: EffectRuntimeHandle<AvailableService> | undefined = EffectReact.useRuntime()
  const run = EffectReact.useRunner()
  const constrainedRunner: <A, E, R extends AvailableService>(
    effect: Effect.Effect<A, E, R>,
  ) => Promise<A> = run
  const missingServiceIsExcluded: MissingService extends AvailableService ? true : false = false

  void constrainedRunner(AvailableService)
  void missingServiceIsExcluded

  return activeRuntime
}

void RuntimeTypeProbe
void providerProps
void missingProviderProps
