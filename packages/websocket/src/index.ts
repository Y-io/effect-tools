import type { Schema } from "effect"

export {
  makeSubscriptionManager,
  type SubscriptionControl,
  type SubscriptionManager,
  type SubscriptionMatch,
} from "./subscription-manager"

export interface SubscriptionDefinition {
  readonly identity: string
  readonly subscribe?: unknown
  readonly unsubscribe?: unknown
}

export const defineProtocol = <
  const MessageSchema extends Schema.Schema.Any,
  const Subscription extends (...args: never[]) => SubscriptionDefinition,
>(definition: {
  readonly schema: MessageSchema
  readonly match: (parsed: unknown, identity: string) => boolean
  readonly subscription: Subscription
}) => definition

type AnyProtocolDefinition = {
  readonly schema: Schema.Schema.Any
  readonly match: (parsed: unknown, identity: string) => boolean
  readonly subscription: (...args: never[]) => SubscriptionDefinition
}

export const defineProtocolCatalog = <
  const Catalog extends Readonly<Record<string, AnyProtocolDefinition>>,
>(
  catalog: Catalog,
): Readonly<Catalog> => Object.freeze(catalog)
