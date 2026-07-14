import { type Headers, HttpClientRequest, type HttpClientResponse } from "@effect/platform"
import { Effect } from "effect"

export const makeRequestProvider = <E, R>(
  provider: (
    request: HttpClientRequest.HttpClientRequest,
  ) => Effect.Effect<HttpClientRequest.HttpClientRequest, E, R>,
) => provider

export const makeHeadersProvider =
  <E, R>(
    provide: (request: HttpClientRequest.HttpClientRequest) => Effect.Effect<Headers.Input, E, R>,
  ) =>
  (request: HttpClientRequest.HttpClientRequest) =>
    provide(request).pipe(
      Effect.map((headers) => request.pipe(HttpClientRequest.setHeaders(headers))),
    )

export const makeResponseProvider = <E, R>(
  provider: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<void, E, R>,
) => provider
