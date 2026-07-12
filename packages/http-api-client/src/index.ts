import {
  type Headers,
  type HttpApi,
  HttpApiClient,
  type HttpApiGroup,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "@effect/platform"
import { Effect } from "effect"

export type RequestProvider<E, R> = (
  request: HttpClientRequest.HttpClientRequest,
) => Effect.Effect<HttpClientRequest.HttpClientRequest, E, R>

export const makeRequestProvider = <E, R>(provider: RequestProvider<E, R>): RequestProvider<E, R> =>
  provider

export const makeHeadersProvider = <E, R>(
  provide: (request: HttpClientRequest.HttpClientRequest) => Effect.Effect<Headers.Input, E, R>,
): RequestProvider<E, R> =>
  makeRequestProvider((request) =>
    provide(request).pipe(
      Effect.map((headers) => request.pipe(HttpClientRequest.setHeaders(headers))),
    ),
  )

export type ResponseProvider<E, R> = (
  response: HttpClientResponse.HttpClientResponse,
) => Effect.Effect<void, E, R>

export const makeResponseProvider = <E, R>(
  provider: ResponseProvider<E, R>,
): ResponseProvider<E, R> => provider

type AnyRequestProvider = RequestProvider<any, any>
type AnyResponseProvider = ResponseProvider<any, any>

type ProviderError<Provider> = Provider extends (
  ...args: ReadonlyArray<any>
) => Effect.Effect<any, infer E, any>
  ? E
  : never

type ProviderContext<Provider> = Provider extends (
  ...args: ReadonlyArray<any>
) => Effect.Effect<any, any, infer R>
  ? R
  : never

export const make = <
  ApiId extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  ApiError,
  ApiR,
  const RequestProviders extends ReadonlyArray<AnyRequestProvider>,
  const ResponseProviders extends ReadonlyArray<AnyResponseProvider>,
>(
  api: HttpApi.HttpApi<ApiId, Groups, ApiError, ApiR>,
  options: {
    readonly requestProviders: RequestProviders
    readonly responseProviders: ResponseProviders
  },
) =>
  Effect.gen(function* () {
    const baseClient = yield* HttpClient.HttpClient
    const requestProvider: RequestProvider<
      ProviderError<RequestProviders[number]>,
      ProviderContext<RequestProviders[number]>
    > = (request) =>
      Effect.reduce(options.requestProviders, request, (currentRequest, provider) =>
        provider(currentRequest),
      )
    const responseProvider: ResponseProvider<
      ProviderError<ResponseProviders[number]>,
      ProviderContext<ResponseProviders[number]>
    > = (response) =>
      Effect.forEach(options.responseProviders, (provider) => provider(response), {
        concurrency: 1,
        discard: true,
      })
    const client = baseClient.pipe(
      HttpClient.mapRequestEffect(requestProvider),
      HttpClient.tap(responseProvider),
    )
    return yield* HttpApiClient.makeWith(api, { httpClient: client })
  })
