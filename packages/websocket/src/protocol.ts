import type { Schema } from "effect"

/** subscription factory 为一个订阅实例生成的稳定标识与可选控制消息。 */
export interface SubscriptionDefinition {
  /** 跨整个协议目录全局唯一的路由与生命周期标识。 */
  readonly identity: string
  /** 连接可用且需要建立远端订阅时构造 subscribe 字符串。 */
  readonly subscribe?: () => string
  /** 连接可用且最后一个本地消费者退出时构造 unsubscribe 字符串。 */
  readonly unsubscribe?: () => string
}

interface ProtocolDefinitionBase<MessageSchema extends Schema.Schema.AnyNoContext> {
  /** 对首个粗匹配命中的完整解析值执行最终解码。 */
  readonly schema: MessageSchema
  /** 判断解析值是否属于指定 identity；不承担数据校验。 */
  readonly match: (parsed: unknown, identity: string) => boolean
}

/** 需要先解码订阅参数的入站消息协议。 */
export interface ParameterizedProtocolDefinition<
  MessageSchema extends Schema.Schema.AnyNoContext,
  SubscriptionSchema extends Schema.Schema.AnyNoContext,
  Subscription extends (params: Schema.Schema.Type<SubscriptionSchema>) => SubscriptionDefinition,
> extends ProtocolDefinitionBase<MessageSchema> {
  /** 将 stream 的 encoded 参数解码为 subscription factory 所需的业务参数。 */
  readonly subscriptionSchema: SubscriptionSchema
  /** 将解码后的业务参数转换为内部订阅定义。 */
  readonly subscription: Subscription
}

/** 不需要订阅参数的入站消息协议。 */
export interface ParameterlessProtocolDefinition<
  MessageSchema extends Schema.Schema.AnyNoContext,
  Subscription extends () => SubscriptionDefinition,
> extends ProtocolDefinitionBase<MessageSchema> {
  readonly subscription: Subscription
}

/** 一个入站消息协议及其订阅实例工厂。 */
export type ProtocolDefinition<
  MessageSchema extends Schema.Schema.AnyNoContext,
  SubscriptionSchema extends Schema.Schema.AnyNoContext | undefined = undefined,
> = [SubscriptionSchema] extends [Schema.Schema.AnyNoContext]
  ? ParameterizedProtocolDefinition<
      MessageSchema,
      SubscriptionSchema,
      (params: Schema.Schema.Type<SubscriptionSchema>) => SubscriptionDefinition
    >
  : ParameterlessProtocolDefinition<MessageSchema, () => SubscriptionDefinition>

/** 仅用于约束异构协议目录的类型擦除形态。 */
export type AnyProtocolDefinition =
  | (ProtocolDefinitionBase<Schema.Schema.AnyNoContext> & {
      readonly subscriptionSchema: Schema.Schema.AnyNoContext
      readonly subscription: (...args: never[]) => SubscriptionDefinition
    })
  | ParameterlessProtocolDefinition<Schema.Schema.AnyNoContext, () => SubscriptionDefinition>

/** 定义协议并保留 Schema 与 subscription 参数的精确类型。 */
export function defineProtocol<
  const MessageSchema extends Schema.Schema.AnyNoContext,
  const SubscriptionSchema extends Schema.Schema.AnyNoContext,
  const Subscription extends (
    params: Schema.Schema.Type<SubscriptionSchema>,
  ) => SubscriptionDefinition,
>(
  definition: ParameterizedProtocolDefinition<MessageSchema, SubscriptionSchema, Subscription>,
): ParameterizedProtocolDefinition<MessageSchema, SubscriptionSchema, Subscription>
export function defineProtocol<
  const MessageSchema extends Schema.Schema.AnyNoContext,
  const Subscription extends () => SubscriptionDefinition,
>(
  definition: ParameterlessProtocolDefinition<MessageSchema, Subscription>,
): ParameterlessProtocolDefinition<MessageSchema, Subscription>
export function defineProtocol(definition: AnyProtocolDefinition): AnyProtocolDefinition {
  return definition
}

/** 创建初始化后不可增删或替换条目的协议目录。 */
export const defineProtocolCatalog = <
  const Catalog extends Readonly<Record<string, AnyProtocolDefinition>>,
>(
  catalog: Catalog,
): Readonly<Catalog> => Object.freeze(catalog)
