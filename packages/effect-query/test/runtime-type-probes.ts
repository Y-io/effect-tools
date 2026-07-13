import { Context, Effect, Runtime } from "effect"
import { makeEffectQueryRuntime, type EffectRuntimeLoader } from "../src/index"

class AvailableService extends Context.Tag("AvailableService")<
  AvailableService,
  { readonly value: string }
>() {}

class MissingService extends Context.Tag("MissingService")<
  MissingService,
  { readonly value: string }
>() {}

const runtime = Runtime.defaultRuntime.pipe(
  Runtime.provideService(AvailableService, { value: "available" }),
)
const EffectQuery = makeEffectQueryRuntime(() => runtime)

const RuntimeTypeProbe = () => {
  const loader: EffectRuntimeLoader<AvailableService> | undefined = EffectQuery.useRuntime()
  const run = EffectQuery.useRunner()
  const constrainedRunner: <A, E, R extends AvailableService>(
    effect: Effect.Effect<A, E, R>,
  ) => Promise<A> = run
  const missingServiceIsExcluded: MissingService extends AvailableService ? true : false = false

  void constrainedRunner(AvailableService)
  void missingServiceIsExcluded

  return loader
}

void RuntimeTypeProbe
