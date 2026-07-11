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

  test("初始化后不能增加、删除或替换协议定义", () => {
    const resourceUpdated = defineProtocol({
      schema: Schema.Struct({ id: Schema.String, value: Schema.Number }),
      match: (_parsed: unknown, identity: string) => identity.length > 0,
      subscription: (id: string) => ({ identity: id }),
    })
    const catalog = defineProtocolCatalog({ resourceUpdated })

    const verifyReadonlyType = () => {
      // @ts-expect-error 协议目录条目初始化后不能被替换
      catalog.resourceUpdated = resourceUpdated
      // @ts-expect-error 协议目录初始化后不能增加新条目
      catalog.other = resourceUpdated
      // @ts-expect-error 协议目录条目初始化后不能被删除
      delete catalog.resourceUpdated
    }

    expect(verifyReadonlyType).toBeTypeOf("function")
    expect(Object.isFrozen(catalog)).toBe(true)
  })
})
