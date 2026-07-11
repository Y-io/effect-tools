import { Effect, PubSub, Stream } from "effect"
import type { Schema } from "effect"
import type { SubscriptionDefinition } from "./index"

export type SubscriptionControl = unknown

interface ProtocolDefinition<MessageSchema extends Schema.Schema.Any> {
  readonly schema: MessageSchema
}

interface SubscriptionRecord {
  readonly definition: SubscriptionDefinition
  readonly messages: PubSub.PubSub<unknown>
  references: number
}

export interface SubscriptionManager {
  readonly stream: <MessageSchema extends Schema.Schema.Any>(
    protocolKey: string,
    protocol: ProtocolDefinition<MessageSchema>,
    definition: SubscriptionDefinition,
  ) => Stream.Stream<Schema.Schema.Type<MessageSchema>>
  readonly publish: (protocolKey: string, identity: string, message: unknown) => Effect.Effect<void>
}

export const makeSubscriptionManager = (
  writeControl: (control: SubscriptionControl) => Effect.Effect<void>,
): Effect.Effect<SubscriptionManager> =>
  Effect.gen(function* () {
    const semaphore = yield* Effect.makeSemaphore(1)
    const records = new Map<string, Map<string, SubscriptionRecord>>()

    const release = (protocolKey: string, identity: string) =>
      semaphore.withPermits(1)(
        Effect.gen(function* () {
          const protocolRecords = records.get(protocolKey)
          const record = protocolRecords?.get(identity)
          if (record === undefined) return

          record.references -= 1
          if (record.references > 0) return

          if (record.definition.unsubscribe !== undefined) {
            yield* writeControl(record.definition.unsubscribe)
          }
          protocolRecords?.delete(identity)
          if (protocolRecords?.size === 0) records.delete(protocolKey)
        }),
      )

    const stream: SubscriptionManager["stream"] = (protocolKey, _protocol, definition) =>
      Stream.unwrapScoped(
        semaphore.withPermits(1)(
          Effect.gen(function* () {
            let protocolRecords = records.get(protocolKey)
            if (protocolRecords === undefined) {
              protocolRecords = new Map()
              records.set(protocolKey, protocolRecords)
            }

            let record = protocolRecords.get(definition.identity)
            const isFirstConsumer = record === undefined
            if (record === undefined) {
              record = {
                definition,
                messages: yield* PubSub.sliding<unknown>(1),
                references: 0,
              }
              protocolRecords.set(definition.identity, record)
            }

            record.references += 1
            const messages = yield* PubSub.subscribe(record.messages)
            yield* Effect.addFinalizer(() => release(protocolKey, definition.identity))

            if (isFirstConsumer && definition.subscribe !== undefined) {
              yield* writeControl(definition.subscribe)
            }

            return Stream.fromQueue(messages) as Stream.Stream<never>
          }),
        ),
      )

    const publish: SubscriptionManager["publish"] = (protocolKey, identity, message) =>
      semaphore.withPermits(1)(
        Effect.gen(function* () {
          const record = records.get(protocolKey)?.get(identity)
          if (record !== undefined) yield* PubSub.publish(record.messages, message)
        }),
      )

    return { stream, publish }
  })
