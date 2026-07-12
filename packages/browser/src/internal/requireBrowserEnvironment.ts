type BrowserGlobal = "document" | "navigator" | "window"

export const requireBrowserEnvironment = <const Global extends BrowserGlobal>(
  service: string,
  ...globals: ReadonlyArray<Global>
): Pick<typeof globalThis, Global> => {
  for (const global of globals) {
    if (globalThis[global] === undefined) {
      throw new Error(`${service} requires a browser environment`)
    }
  }
  return globalThis
}
