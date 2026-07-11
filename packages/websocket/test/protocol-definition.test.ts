import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { defineProtocol } from "../src/index"

describe("协议定义", () => {
  test("保留 Schema、粗匹配函数和 subscription factory", () => {
    const schema = Schema.Struct({
      symbol: Schema.String,
      price: Schema.Number,
    })
    const match = (parsed: unknown, identity: string) =>
      typeof parsed === "object" &&
      parsed !== null &&
      "symbol" in parsed &&
      parsed.symbol === identity
    const subscription = (symbol: string) => ({ identity: symbol })

    const protocol = defineProtocol({ schema, match, subscription })

    expect(protocol.schema).toBe(schema)
    expect(protocol.match).toBe(match)
    expect(protocol.subscription).toBe(subscription)
  })
})
