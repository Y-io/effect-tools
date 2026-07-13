import "@tanstack/react-start/client-only"
import { ManagedRuntime } from "effect"
import { PrototypeClient } from "./query"

if (typeof window === "undefined") {
  throw new Error("browser runtime module was evaluated on the server")
}

Object.assign(globalThis, { __effectQueryBrowserRuntimeLoaded: true })

export const browserManagedRuntime = ManagedRuntime.make(PrototypeClient.Default)
