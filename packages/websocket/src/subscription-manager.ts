import { Effect, Option, PubSub, Queue, Stream } from "effect"
import type { Schema, Scope } from "effect"
import type { SubscriptionDefinition } from "./index"

export type SubscriptionControl = unknown

interface ProtocolDefinition<MessageSchema extends Schema.Schema.Any> {
  readonly schema: MessageSchema
  readonly match: (parsed: unknown, identity: string) => boolean
}

interface SubscriptionRecord {
  readonly protocolKey: string
  readonly protocol: ProtocolDefinition<Schema.Schema.Any>
  readonly definition: SubscriptionDefinition
  readonly messages: PubSub.PubSub<unknown>
  references: number
}

export interface SubscriptionMatch {
  readonly protocolKey: string
  readonly protocol: ProtocolDefinition<Schema.Schema.Any>
  readonly identity: string
  readonly publish: (message: unknown) => Effect.Effect<void>
}

export interface SubscriptionManager {
  readonly stream: <MessageSchema extends Schema.Schema.Any>(
    protocolKey: string,
    protocol: ProtocolDefinition<MessageSchema>,
    definition: SubscriptionDefinition,
  ) => Stream.Stream<Schema.Schema.Type<MessageSchema>>
  readonly publish: (protocolKey: string, identity: string, message: unknown) => Effect.Effect<void>
  readonly match: (parsed: unknown) => Effect.Effect<Option.Option<SubscriptionMatch>>
}

export const makeSubscriptionManager = (
  writeControl: (control: SubscriptionControl) => Effect.Effect<void>,
): Effect.Effect<SubscriptionManager, never, Scope.Scope> =>
  Effect.gen(function* () {
    const semaphore = yield* Effect.makeSemaphore(1)
    const controlQueue = yield* Queue.unbounded<SubscriptionControl>()
    const records = new Map<string, Map<string, SubscriptionRecord>>()
    const orderedRecords: Array<SubscriptionRecord> = []

    yield* Effect.addFinalizer(() => Queue.shutdown(controlQueue))
    yield* Queue.take(controlQueue).pipe(
      Effect.flatMap(writeControl),
      Effect.forever,
      Effect.forkScoped,
    )

    const release = (protocolKey: string, identity: string) =>
      semaphore.withPermits(1)(
        Effect.gen(function* () {
          const protocolRecords = records.get(protocolKey)
          const record = protocolRecords?.get(identity)
          if (record === undefined) return

          record.references -= 1
          if (record.references > 0) return

          if (record.definition.unsubscribe !== undefined) {
            yield* Queue.offer(controlQueue, record.definition.unsubscribe)
          }
          protocolRecords?.delete(identity)
          if (protocolRecords?.size === 0) records.delete(protocolKey)
          const orderIndex = orderedRecords.indexOf(record)
          if (orderIndex >= 0) orderedRecords.splice(orderIndex, 1)
        }),
      )

    const stream: SubscriptionManager["stream"] = (protocolKey, protocol, definition) =>
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
                protocolKey,
                protocol,
                definition,
                messages: yield* PubSub.sliding<unknown>(1),
                references: 0,
              }
              protocolRecords.set(definition.identity, record)
              orderedRecords.push(record)
            }

            record.references += 1
            const messages = yield* PubSub.subscribe(record.messages)
            yield* Effect.addFinalizer(() => release(protocolKey, definition.identity))

            if (isFirstConsumer && definition.subscribe !== undefined) {
              yield* Queue.offer(controlQueue, definition.subscribe)
            }

            return Stream.fromQueue(messages) as Stream.Stream<never>
          }),
        ),
      )

    const publish: SubscriptionManager["publish"] = (protocolKey, identity, message) =>
      Effect.gen(function* () {
        const record = records.get(protocolKey)?.get(identity)
        if (record !== undefined) yield* PubSub.publish(record.messages, message)
      })

    const match: SubscriptionManager["match"] = (parsed) =>
      Effect.sync(() => {
        for (const record of orderedRecords) {
          if (record.protocol.match(parsed, record.definition.identity)) {
            return Option.some({
              protocolKey: record.protocolKey,
              protocol: record.protocol,
              identity: record.definition.identity,
              publish: (message) => PubSub.publish(record.messages, message).pipe(Effect.asVoid),
            })
          }
        }
        return Option.none()
      })

    return { stream, publish, match }
  })
