const { default: app } = await import("./dist/server/server.js")
const response = await app.fetch(new Request("http://localhost/"))
const html = await response.text()

const checks = {
  clientDataAbsent: !html.includes('data-query-data="client-runtime"'),
  fetchIdle: html.includes('data-query-fetch-status="idle"'),
  hydratedFalse: html.includes('data-hydrated="false"'),
  providerRendered: html.includes('data-effect-query-provider="rendered"'),
  queryPending: html.includes('data-query-status="pending"'),
  statusOk: response.status === 200,
}

if (Object.values(checks).includes(false)) {
  throw new Error(`TanStack Start SSR verification failed: ${JSON.stringify(checks)}`)
}

console.log(`TanStack Start SSR verification passed: ${JSON.stringify(checks)}`)
