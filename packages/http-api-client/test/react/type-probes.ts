import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "@effect/platform"
import { Effect, ManagedRuntime, Schema } from "effect"
import {
  makeEffectMutation,
  makeEffectQuery,
  makeEffectReactRuntime,
  type EffectMutationOptions,
  type EffectQueryOptions,
} from "../../src/react/index"

// @ts-expect-error options 只能由 makeEffectQuery 构造
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

const healthQuery = makeEffectQuery(ApiClient, (client) => client.test.health, "GET:test.health")
const healthOptions = healthQuery.options()
const healthKey: "GET:test.health" = healthQuery.key
const healthInput: {} = healthOptions.queryKey[1]

const healthMutation = makeEffectMutation(
  ApiClient,
  (client) => client.test.health,
  "GET:test.health",
)
const healthMutationKey: readonly ["GET:test.health"] = healthMutation.options().mutationKey

// @ts-expect-error Query descriptor key 不能为空字符串
makeEffectQuery(ApiClient, (client) => client.test.health, "")
// @ts-expect-error Mutation descriptor key 不能为空字符串
makeEffectMutation(ApiClient, (client) => client.test.health, "")

declare const dynamicKey: string
// @ts-expect-error Query descriptor key 必须是静态字符串 literal
makeEffectQuery(ApiClient, (client) => client.test.health, dynamicKey)
// @ts-expect-error Mutation descriptor key 必须是静态字符串 literal
makeEffectMutation(ApiClient, (client) => client.test.health, dynamicKey)

const dynamicTemplateKey = `GET:${dynamicKey}` as const
// @ts-expect-error 包含动态 string 的模板 key 仍然不是静态字符串
makeEffectQuery(ApiClient, (client) => client.test.health, dynamicTemplateKey)
// @ts-expect-error 包含动态 string 的模板 key 仍然不是静态字符串
makeEffectMutation(ApiClient, (client) => client.test.health, dynamicTemplateKey)

const staticKey = "GET:test.static" as const
const staticQuery = makeEffectQuery(ApiClient, (client) => client.test.health, staticKey)
const preservedStaticKey: "GET:test.static" = staticQuery.key
void preservedStaticKey

declare const staticKeyUnion: "GET:test.first" | "GET:test.second"
const unionQuery = makeEffectQuery(ApiClient, (client) => client.test.health, staticKeyUnion)
const preservedStaticKeyUnion: "GET:test.first" | "GET:test.second" = unionQuery.key
void preservedStaticKeyUnion

const searchQuery = makeEffectQuery(ApiClient, (client) => client.test.search, "POST:test.search")
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

const unsupportedHeadersQuery = makeEffectQuery(
  ApiClient,
  (client) => client.test.searchWithHeaders,
  "POST:test.search-with-headers",
)
// @ts-expect-error endpoints with required headers produce no query descriptor
void unsupportedHeadersQuery.options

const headersMutation = makeEffectMutation(
  ApiClient,
  (client) => client.test.searchWithHeaders,
  "POST:test.search-with-headers",
)

// @ts-expect-error FormData payloads are not JSON query input
makeEffectQuery(ApiClient, (client) => client.test.upload, "POST:test.upload")

const uploadMutation = makeEffectMutation(
  ApiClient,
  (client) => client.test.upload,
  "POST:test.upload",
)

const findQuery = makeEffectQuery(ApiClient, (client) => client.test.find, "POST:test.find")
findQuery.options({ payload: { id: "u-1" } })
findQuery.options({ payload: { slug: "ada" } })

void healthKey
void healthInput
void healthMutationKey
void searchKey
void handwrittenOptions

declare const apiRuntime: ManagedRuntime.ManagedRuntime<ApiClient, never>
const EffectReact = makeEffectReactRuntime<ApiClient>()
type ProviderProps = Parameters<typeof EffectReact.Provider>[0]
const providerProps: ProviderProps = { runtime: apiRuntime }

const MutationTypeProbe = () => {
  const health = EffectReact.useEffectMutation(healthMutation.options())
  health.mutate()

  const headers = EffectReact.useEffectMutation({
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

  const upload = EffectReact.useEffectMutation(uploadMutation.options())
  upload.mutate({ payload: new FormData() })

  return null
}

// @ts-expect-error options 只能由 makeEffectMutation 构造
const handwrittenMutationOptions: EffectMutationOptions<{}, string, never, never> = {
  mutationKey: ["POST:test.handwritten"],
  mutationFn: () => Effect.succeed("unsupported"),
}

void MutationTypeProbe
void handwrittenMutationOptions
void providerProps
