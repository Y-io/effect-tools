import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "@effect/platform"
import { Effect, Schema } from "effect"
import { makeEffectQueryOptions, type EffectQueryOptions } from "../../src/react-query/index"

// @ts-expect-error options 只能由 makeEffectQueryOptions 构造
const handwrittenOptions: EffectQueryOptions<{}, string, never, never> = {
  queryKey: ["GET:test.handwritten", {}],
  queryFn: () => Effect.succeed("unsupported"),
}

const healthEndpoint = HttpApiEndpoint.get("health", "/health").addSuccess(Schema.String)
const searchEndpoint = HttpApiEndpoint.post(
  "search",
  "/organizations/:organizationId/collections/:collectionId/search",
)
  .setPath(Schema.Struct({ organizationId: Schema.String, collectionId: Schema.String }))
  .setUrlParams(
    Schema.Struct({ cursor: Schema.optional(Schema.String), limit: Schema.NumberFromString }),
  )
  .setPayload(
    Schema.Struct({
      filters: Schema.Array(
        Schema.Struct({ field: Schema.String, values: Schema.Array(Schema.String) }),
      ),
    }),
  )
  .addSuccess(Schema.Array(Schema.String))
const searchWithHeadersEndpoint = HttpApiEndpoint.post(
  "searchWithHeaders",
  "/organizations/:organizationId/collections/:collectionId/search",
)
  .setPath(Schema.Struct({ organizationId: Schema.String, collectionId: Schema.String }))
  .setUrlParams(
    Schema.Struct({ cursor: Schema.optional(Schema.String), limit: Schema.NumberFromString }),
  )
  .setPayload(
    Schema.Struct({
      filters: Schema.Array(
        Schema.Struct({ field: Schema.String, values: Schema.Array(Schema.String) }),
      ),
    }),
  )
  .setHeaders(Schema.Struct({ authorization: Schema.String }))
  .addSuccess(Schema.Array(Schema.String))
const uploadEndpoint = HttpApiEndpoint.post("upload", "/upload")
  .setPayload(HttpApiSchema.Multipart(Schema.Struct({ description: Schema.String })))
  .addSuccess(Schema.String)
const findEndpoint = HttpApiEndpoint.post("find", "/find")
  .setPayload(
    Schema.Union(Schema.Struct({ id: Schema.String }), Schema.Struct({ slug: Schema.String })),
  )
  .addSuccess(Schema.String)

const api = HttpApi.make("api").add(
  HttpApiGroup.make("test")
    .add(healthEndpoint)
    .add(searchEndpoint)
    .add(searchWithHeadersEndpoint)
    .add(uploadEndpoint)
    .add(findEndpoint),
)
const clientEffect = HttpApiClient.make(api)
class ApiClient extends Effect.Service<ApiClient>()("ApiClient", { effect: clientEffect }) {}

const healthQuery = makeEffectQueryOptions(
  ApiClient,
  (client) => client.test.health,
  "GET:test.health",
)
const healthOptions = healthQuery.options()
const healthKey: "GET:test.health" = healthQuery.key
const healthInput: {} = healthOptions.queryKey[1]

const searchQuery = makeEffectQueryOptions(
  ApiClient,
  (client) => client.test.search,
  "POST:test.search",
)
const searchOptions = searchQuery.options({
  path: { organizationId: "org-1", collectionId: "collection-1" },
  urlParams: { cursor: "next", limit: 20 },
  payload: { filters: [{ field: "status", values: ["active"] }] },
})
const searchKey: "POST:test.search" = searchOptions.queryKey[0]

searchQuery.options({
  path: { organizationId: "org-1", collectionId: "collection-1" },
  // @ts-expect-error limit is required by the endpoint request
  urlParams: { cursor: "next" },
  payload: { filters: [{ field: "status", values: ["active"] }] },
})

const unsupportedHeadersQuery = makeEffectQueryOptions(
  ApiClient,
  (client) => client.test.searchWithHeaders,
  "POST:test.search-with-headers",
)
// @ts-expect-error endpoints with required headers produce no query descriptor
void unsupportedHeadersQuery.options

// @ts-expect-error FormData payloads are not JSON query input
makeEffectQueryOptions(ApiClient, (client) => client.test.upload, "POST:test.upload")

const findQuery = makeEffectQueryOptions(ApiClient, (client) => client.test.find, "POST:test.find")
findQuery.options({ payload: { id: "u-1" } })
findQuery.options({ payload: { slug: "ada" } })

void healthKey
void healthInput
void searchKey
void handwrittenOptions
