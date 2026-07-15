import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { defineProtocol } from "../src/index"

describe("协议定义", () => {
  test("保留消息 Schema、订阅参数 Schema、粗匹配函数和 subscription factory", () => {
    const schema = Schema.Struct({
      id: Schema.String,
      value: Schema.Number,
    })
    const subscriptionSchema = Schema.Struct({ id: Schema.String })
    const match = (parsed: unknown, identity: string) =>
      typeof parsed === "object" && parsed !== null && "id" in parsed && parsed.id === identity
    const subscription = ({ id }: { readonly id: string }) => ({ identity: id })

    const protocol = defineProtocol({ schema, subscriptionSchema, match, subscription })

    expect(protocol.schema).toBe(schema)
    expect(protocol.subscriptionSchema).toBe(subscriptionSchema)
    expect(protocol.match).toBe(match)
    expect(protocol.subscription).toBe(subscription)
  })

  test("约束协议组成部分并保留精确类型", () => {
    const protocol = defineProtocol({
      schema: Schema.Struct({ value: Schema.Number }),
      subscriptionSchema: Schema.Struct({ group: Schema.String, itemId: Schema.Number }),
      match: (_parsed: unknown, identity: string) => identity.length > 0,
      subscription: ({ group, itemId }) => ({
        identity: `${group}:${itemId}`,
      }),
    })

    const args: Parameters<typeof protocol.subscription> = [{ group: "primary", itemId: 42 }]
    const message: Schema.Schema.Type<typeof protocol.schema> = { value: 1 }
    const passive = defineProtocol({
      schema: Schema.String,
      subscriptionSchema: Schema.Void,
      match: (_parsed: unknown, identity: string) => identity === "status",
      subscription: () => ({ identity: "status" }),
    })
    const verifyTypes = () => {
      // @ts-expect-error 参数必须符合 subscriptionSchema 的输出类型
      void protocol.subscription({ group: "primary", itemId: "42" })
      // @ts-expect-error 被动协议的 subscription 不接受参数
      void passive.subscription("unexpected")
      // @ts-expect-error 消息必须符合消息 Schema 的输出类型
      const invalidMessage: Schema.Schema.Type<typeof protocol.schema> = null
      void invalidMessage
      // @ts-expect-error 每个协议都必须由 subscriptionSchema 决定参数类型
      void defineProtocol({
        schema: Schema.String,
        match: (_parsed: unknown, identity: string) => identity === "missing-schema",
        subscription: () => ({ identity: "missing-schema" }),
      })
    }

    expect(args).toEqual([{ group: "primary", itemId: 42 }])
    expect(message).toEqual({ value: 1 })
    expect(passive.subscription()).toEqual({ identity: "status" })
    expect(verifyTypes).toBeTypeOf("function")
  })
})
