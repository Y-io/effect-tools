import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { defineProtocol, defineProtocolCatalog } from "../src/index"

describe("协议目录", () => {
  test("以具名条目组成目录并保留精确协议键", () => {
    const resourceUpdated = defineProtocol({
      schema: Schema.Struct({ id: Schema.String, value: Schema.Number }),
      match: (_parsed: unknown, identity: string) => identity.length > 0,
      subscription: (id: string) => ({ identity: id }),
    })
    const statusChanged = defineProtocol({
      schema: Schema.Struct({ id: Schema.String, active: Schema.Boolean }),
      match: (_parsed: unknown, identity: string) => identity.length > 0,
      subscription: (id: string) => ({ identity: id }),
    })

    const catalog = defineProtocolCatalog({
      resourceUpdated,
      statusChanged,
    })
    const keys: ReadonlyArray<keyof typeof catalog> = [
      "resourceUpdated",
      "statusChanged",
    ]

    expect(keys).toEqual(["resourceUpdated", "statusChanged"])
    expect(catalog.resourceUpdated).toBe(resourceUpdated)
    expect(catalog.statusChanged).toBe(statusChanged)
  })
})
