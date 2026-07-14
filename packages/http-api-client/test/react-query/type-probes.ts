import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "@effect/platform"
import { Effect, Runtime, Schema } from "effect"
import {
  makeEffectMutationOptions,
  makeEffectQueryOptions,
  makeEffectQueryRuntime,
  type EffectMutationOptions,
  type EffectQueryOptions,
} from "../../src/react-query/index"

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

const healthMutation = makeEffectMutationOptions(
  ApiClient,
  (client) => client.test.health,
  "GET:test.health",
)
const healthMutationKey: readonly ["GET:test.health"] = healthMutation.options().mutationKey

// @ts-expect-error Query descriptor key 不能为空字符串
makeEffectQueryOptions(ApiClient, (client) => client.test.health, "")
// @ts-expect-error Mutation descriptor key 不能为空字符串
makeEffectMutationOptions(ApiClient, (client) => client.test.health, "")

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

const headersMutation = makeEffectMutationOptions(
  ApiClient,
  (client) => client.test.searchWithHeaders,
  "POST:test.search-with-headers",
)

// @ts-expect-error FormData payloads are not JSON query input
makeEffectQueryOptions(ApiClient, (client) => client.test.upload, "POST:test.upload")

const uploadMutation = makeEffectMutationOptions(
  ApiClient,
  (client) => client.test.upload,
  "POST:test.upload",
)

const findQuery = makeEffectQueryOptions(ApiClient, (client) => client.test.find, "POST:test.find")
findQuery.options({ payload: { id: "u-1" } })
findQuery.options({ payload: { slug: "ada" } })

void healthKey
void healthInput
void healthMutationKey
void searchKey
void handwrittenOptions

declare const apiRuntime: Runtime.Runtime<ApiClient>
const EffectQuery = makeEffectQueryRuntime(() => apiRuntime)

const MutationTypeProbe = () => {
  const health = EffectQuery.useEffectMutation(healthMutation.options())
  health.mutate()

  const headers = EffectQuery.useEffectMutation({
    ...headersMutation.options(),
    scope: { id: "search-write" },
    retry: 1,
    onMutate: (variables) => ({ organizationId: variables.path.organizationId }),
    onError: (_error, _variables, result) => {
      const typedResult: { readonly organizationId: string } | undefined = result
      void typedResult
    },
  })
  headers.mutate({
    path: { organizationId: "org-1", collectionId: "collection-1" },
    urlParams: { cursor: "next", limit: 20 },
    payload: { filters: [{ field: "status", values: ["active"] }] },
    headers: { authorization: "Bearer token" },
  })
  headers.mutate({
    path: { organizationId: "org-1", collectionId: "collection-1" },
    urlParams: { cursor: "next", limit: 20 },
    payload: { filters: [{ field: "status", values: ["active"] }] },
    headers: { authorization: "Bearer token" },
    // @ts-expect-error Mutation 固定 withResponse = false
    withResponse: true,
  })

  const upload = EffectQuery.useEffectMutation(uploadMutation.options())
  upload.mutate({ payload: new FormData() })

  return null
}

// @ts-expect-error options 只能由 makeEffectMutationOptions 构造
const handwrittenMutationOptions: EffectMutationOptions<{}, string, never, never> = {
  mutationKey: ["POST:test.handwritten"],
  mutationFn: () => Effect.succeed("unsupported"),
}

void MutationTypeProbe
void handwrittenMutationOptions
