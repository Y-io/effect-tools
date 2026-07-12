export const isBrowserEnvironment = (): boolean =>
  typeof window !== "undefined" &&
  typeof document !== "undefined" &&
  typeof navigator !== "undefined"
