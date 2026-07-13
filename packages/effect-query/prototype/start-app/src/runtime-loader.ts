import { createClientOnlyFn } from "@tanstack/react-start"

export const loadBrowserRuntime = createClientOnlyFn(async () => {
  const { browserManagedRuntime } = await import("./runtime.client")
  return browserManagedRuntime.runtime()
})
