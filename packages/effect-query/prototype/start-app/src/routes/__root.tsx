import { QueryClientProvider, type QueryClient } from "@tanstack/react-query"
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  useHydrated,
} from "@tanstack/react-router"
import { EffectQuery } from "../effect-query"

export const Route = createRootRouteWithContext<{ readonly queryClient: QueryClient }>()({
  component: RootComponent,
  shellComponent: RootShell,
})

function RootComponent() {
  const { queryClient } = Route.useRouteContext()
  const hydrated = useHydrated()

  return (
    <QueryClientProvider client={queryClient}>
      <EffectQuery.Provider enabled={hydrated}>
        <main data-effect-query-provider="rendered" data-hydrated={String(hydrated)}>
          <Outlet />
        </main>
      </EffectQuery.Provider>
    </QueryClientProvider>
  )
}

function RootShell({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
