import { makeEffectQueryRuntime } from "@pkg/effect-query"
import { loadBrowserRuntime } from "./runtime-loader"

export const EffectQuery = makeEffectQueryRuntime(loadBrowserRuntime)
