import { createFileRoute } from "@tanstack/react-router"
import { EffectQuery } from "../effect-query"
import { clientOnlyQuery } from "../query"

export const Route = createFileRoute("/")({ component: IndexPage })

function IndexPage() {
  const query = EffectQuery.useEffectQuery(clientOnlyQuery.options())

  return (
    <section
      data-query-data={query.data}
      data-query-fetch-status={query.fetchStatus}
      data-query-status={query.status}
    >
      Effect Query TanStack Start SSR prototype
    </section>
  )
}
