import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { defineProtocol } from "../src/index"

describe("协议定义", () => {
  test("保留 Schema、粗匹配函数和 subscription factory", () => {
    const schema = Schema.Struct({
      id: Schema.String,
      value: Schema.Number,
    })
    const match = (parsed: unknown, identity: string) =>
      typeof parsed === "object" && parsed !== null && "id" in parsed && parsed.id === identity
    const subscription = (id: string) => ({ identity: id })

    const protocol = defineProtocol({ schema, match, subscription })

    expect(protocol.schema).toBe(schema)
    expect(protocol.match).toBe(match)
    expect(protocol.subscription).toBe(subscription)
  })

  test("约束协议组成部分并保留精确类型", () => {
    const protocol = defineProtocol({
      schema: Schema.Struct({ value: Schema.Number }),
      match: (_parsed: unknown, identity: string) => identity.length > 0,
      subscription: (group: string, itemId: number) => ({
        identity: `${group}:${itemId}`,
      }),
    })

    const args: Parameters<typeof protocol.subscription> = ["primary", 42]
    const message: Schema.Schema.Type<typeof protocol.schema> = { value: 1 }

    expect(args).toEqual(["primary", 42])
    expect(message).toEqual({ value: 1 })

    void defineProtocol({
      // @ts-expect-error schema 必须是 Effect Schema
      schema: "not-a-schema",
      match: (_parsed: unknown, _identity: string) => true,
      subscription: () => ({ identity: "resource" }),
    })

    void defineProtocol({
      schema: Schema.Number,
      // @ts-expect-error match 必须返回 boolean
      match: (_parsed: unknown, _identity: string) => "matched",
      subscription: () => ({ identity: "resource" }),
    })

    void defineProtocol({
      schema: Schema.Number,
      match: (_parsed: unknown, _identity: string) => true,
      // @ts-expect-error subscription identity 必须是 string
      subscription: () => ({ identity: 42 }),
    })
  })
})
