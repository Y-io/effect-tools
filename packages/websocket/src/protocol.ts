import type { Schema } from "effect"

/** subscription factory 为一个订阅实例生成的稳定标识与可选控制消息。 */
export interface SubscriptionDefinition {
  /** 协议定义内唯一的路由与生命周期标识。 */
  readonly identity: string
  /** 连接可用且需要建立远端订阅时构造 subscribe 字符串。 */
  readonly subscribe?: () => string
  /** 连接可用且最后一个本地消费者退出时构造 unsubscribe 字符串。 */
  readonly unsubscribe?: () => string
}

/** 一个入站消息协议及其订阅实例工厂。 */
export interface ProtocolDefinition<
  MessageSchema extends Schema.Schema.AnyNoContext,
  Subscription extends (...args: never[]) => SubscriptionDefinition,
> {
  /** 对首个粗匹配命中的完整解析值执行最终解码。 */
  readonly schema: MessageSchema
  /** 判断解析值是否属于指定 identity；不承担数据校验。 */
  readonly match: (parsed: unknown, identity: string) => boolean
  /** 将业务参数转换为内部订阅定义。 */
  readonly subscription: Subscription
}

/** 仅用于约束异构协议目录的类型擦除形态。 */
export type AnyProtocolDefinition = {
  readonly schema: Schema.Schema.AnyNoContext
  readonly match: (parsed: unknown, identity: string) => boolean
  readonly subscription: (...args: never[]) => SubscriptionDefinition
}

/** 定义协议并保留 Schema 与 subscription 参数的精确类型。 */
export const defineProtocol = <
  const MessageSchema extends Schema.Schema.AnyNoContext,
  const Subscription extends (...args: never[]) => SubscriptionDefinition,
>(definition: {
  readonly schema: MessageSchema
  readonly match: (parsed: unknown, identity: string) => boolean
  readonly subscription: Subscription
}) => definition

/** 创建初始化后不可增删或替换条目的协议目录。 */
export const defineProtocolCatalog = <
  const Catalog extends Readonly<Record<string, AnyProtocolDefinition>>,
>(
  catalog: Catalog,
): Readonly<Catalog> => Object.freeze(catalog)
