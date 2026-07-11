import type { Schema } from "effect"

export interface SubscriptionDefinition {
  readonly identity: string
  readonly subscribe?: () => string
  readonly unsubscribe?: () => string
}

export interface ProtocolDefinition<
  MessageSchema extends Schema.Schema.AnyNoContext,
  Subscription extends (...args: never[]) => SubscriptionDefinition,
> {
  readonly schema: MessageSchema
  readonly match: (parsed: unknown, identity: string) => boolean
  readonly subscription: Subscription
}

export type AnyProtocolDefinition = {
  readonly schema: Schema.Schema.AnyNoContext
  readonly match: (parsed: unknown, identity: string) => boolean
  readonly subscription: (...args: never[]) => SubscriptionDefinition
}

export const defineProtocol = <
  const MessageSchema extends Schema.Schema.AnyNoContext,
  const Subscription extends (...args: never[]) => SubscriptionDefinition,
>(definition: {
  readonly schema: MessageSchema
  readonly match: (parsed: unknown, identity: string) => boolean
  readonly subscription: Subscription
}) => definition

export const defineProtocolCatalog = <
  const Catalog extends Readonly<Record<string, AnyProtocolDefinition>>,
>(
  catalog: Catalog,
): Readonly<Catalog> => Object.freeze(catalog)
