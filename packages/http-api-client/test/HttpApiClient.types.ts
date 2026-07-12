import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpClientError,
  HttpClientRequest,
} from "@effect/platform"
import { Context, Data, Effect, ParseResult, Schema } from "effect"
import { make, makeRequestProvider, makeResponseProvider } from "../src/index"

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

class RequestFailure extends Data.TaggedError("RequestFailure") {}
class ResponseFailure extends Data.TaggedError("ResponseFailure") {}

class RequestDependency extends Context.Tag("test/RequestDependency")<
  RequestDependency,
  { readonly run: Effect.Effect<void, RequestFailure> }
>() {}

class ResponseDependency extends Context.Tag("test/ResponseDependency")<
  ResponseDependency,
  { readonly run: Effect.Effect<void, ResponseFailure> }
>() {}

const api = HttpApi.make("types").add(
  HttpApiGroup.make("test").add(
    HttpApiEndpoint.get("getValue", "/value").addSuccess(Schema.Struct({ value: Schema.String })),
  ),
)

const requestProvider = makeRequestProvider((request) =>
  Effect.gen(function* () {
    const dependency = yield* RequestDependency
    yield* dependency.run
    return request.pipe(HttpClientRequest.setHeader("x-request", "set"))
  }),
)

const responseProvider = makeResponseProvider(() =>
  Effect.gen(function* () {
    const dependency = yield* ResponseDependency
    yield* dependency.run
  }),
)

const clientEffect = make(api, {
  requestProviders: [requestProvider],
  responseProviders: [responseProvider],
})

type Client = Effect.Effect.Success<typeof clientEffect>

const proveEndpointTypes = (client: Client) => {
  const call = client.test.getValue({})

  const success: Equal<Effect.Effect.Success<typeof call>, { readonly value: string }> = true
  const error: Equal<
    Effect.Effect.Error<typeof call>,
    | RequestFailure
    | ResponseFailure
    | HttpApiError.HttpApiDecodeError
    | HttpClientError.HttpClientError
    | ParseResult.ParseError
  > = true
  const context: Equal<
    Effect.Effect.Context<typeof call>,
    RequestDependency | ResponseDependency
  > = true

  return { success, error, context }
}

void proveEndpointTypes
