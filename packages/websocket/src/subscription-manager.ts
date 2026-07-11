import * as Socket from "@effect/platform/Socket"
import { Chunk, Deferred, Effect, HashMap, Option, Queue, Ref, Stream } from "effect"
import type { Schema, Scope } from "effect"
import type { SubscriptionDefinition } from "./protocol"

interface MessageProtocol<MessageSchema extends Schema.Schema.AnyNoContext> {
  readonly schema: MessageSchema
  readonly match: (parsed: unknown, identity: string) => boolean
}

interface Consumer {
  readonly id: object
  readonly messages: Queue.Queue<unknown>
}

/** identity 唯一标识的活跃订阅及其全部本地消费者。 */
interface SubscriptionRecord {
  readonly identity: string
  readonly protocol: MessageProtocol<Schema.Schema.AnyNoContext>
  readonly definition: SubscriptionDefinition
  readonly consumers: Chunk.Chunk<Consumer>
}

interface ConnectionEpoch {
  readonly send: (control: string) => Effect.Effect<void, Socket.SocketError>
  readonly failed: Deferred.Deferred<void, Socket.SocketError>
}

interface SubscriptionState {
  readonly records: HashMap.HashMap<string, SubscriptionRecord>
  readonly orderedRecords: Chunk.Chunk<SubscriptionRecord>
  readonly connection: Option.Option<ConnectionEpoch>
}

type SubscriptionEvent =
  | {
      readonly type: "Acquire"
      readonly identity: string
      readonly protocol: MessageProtocol<Schema.Schema.AnyNoContext>
      readonly definition: SubscriptionDefinition
      readonly consumer: Consumer
    }
  | {
      readonly type: "Release"
      readonly identity: string
      readonly consumerId: object
    }
  | {
      readonly type: "Connected"
      readonly connection: ConnectionEpoch
    }
  | {
      readonly type: "Disconnected"
      readonly connection: ConnectionEpoch
    }

export interface SubscriptionMatch {
  readonly protocol: MessageProtocol<Schema.Schema.AnyNoContext>
  readonly identity: string
  /** 将 Schema 解码后的消息发送给这个订阅的全部消费者。 */
  readonly publish: (message: unknown) => Effect.Effect<void>
}

export interface SubscriptionManager {
  /** 创建消费者数据流，并异步提交 identity 对应的 Acquire 事件。 */
  readonly stream: <MessageSchema extends Schema.Schema.AnyNoContext>(
    protocol: MessageProtocol<MessageSchema>,
    definition: SubscriptionDefinition,
  ) => Stream.Stream<Schema.Schema.Type<MessageSchema>>
  /** 按订阅创建顺序查找唯一匹配的活跃订阅。 */
  readonly match: (parsed: unknown) => Effect.Effect<Option.Option<SubscriptionMatch>>
  /** 在 connection epoch 存活期间安装 sender，并传播控制消息发送失败。 */
  readonly runConnection: (
    send: (control: string) => Effect.Effect<void, Socket.SocketError>,
  ) => Effect.Effect<void, Socket.SocketError, Scope.Scope>
}

const emptyState: SubscriptionState = {
  records: HashMap.empty(),
  orderedRecords: Chunk.empty(),
  connection: Option.none(),
}

const replaceOrderedRecord = (
  records: Chunk.Chunk<SubscriptionRecord>,
  previous: SubscriptionRecord,
  next: SubscriptionRecord,
) => Chunk.map(records, (record) => (record === previous ? next : record))

/** 创建由单一事件 Fiber 维护订阅列表的 scoped Subscription Manager。 */
export const makeSubscriptionManager = (): Effect.Effect<SubscriptionManager, never, Scope.Scope> =>
  Effect.gen(function* () {
    const events = yield* Queue.unbounded<SubscriptionEvent>()
    const stateRef = yield* Ref.make(emptyState)

    yield* Effect.addFinalizer(() =>
      Ref.getAndSet(stateRef, emptyState).pipe(
        Effect.flatMap((state) =>
          Effect.forEach(
            state.orderedRecords,
            (record) =>
              Effect.forEach(record.consumers, (consumer) => Queue.shutdown(consumer.messages), {
                discard: true,
              }),
            { discard: true },
          ),
        ),
        Effect.zipRight(Queue.shutdown(events)),
      ),
    )

    /** send 失败会使当前 epoch 失效并唤醒 Socket Client，订阅事件 Fiber 继续存活。 */
    const sendControl = (state: SubscriptionState, control: string) =>
      Option.match(state.connection, {
        onNone: () => Effect.succeed(state),
        onSome: (connection) =>
          connection.send(control).pipe(
            Effect.as(state),
            Effect.catchAll((error) =>
              Deferred.fail(connection.failed, error).pipe(
                Effect.as({ ...state, connection: Option.none() }),
              ),
            ),
          ),
      })

    const handleEvent = (event: SubscriptionEvent) =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef)

        switch (event.type) {
          case "Acquire": {
            const current = HashMap.get(state.records, event.identity)
            if (Option.isSome(current)) {
              const record = {
                ...current.value,
                consumers: Chunk.append(current.value.consumers, event.consumer),
              }
              yield* Ref.set(stateRef, {
                ...state,
                records: HashMap.set(state.records, event.identity, record),
                orderedRecords: replaceOrderedRecord(state.orderedRecords, current.value, record),
              })
              return
            }

            const record: SubscriptionRecord = {
              identity: event.identity,
              protocol: event.protocol,
              definition: event.definition,
              consumers: Chunk.of(event.consumer),
            }
            const next = {
              ...state,
              records: HashMap.set(state.records, event.identity, record),
              orderedRecords: Chunk.append(state.orderedRecords, record),
            }
            yield* Ref.set(stateRef, next)
            if (event.definition.subscribe) {
              yield* sendControl(next, event.definition.subscribe()).pipe(
                Effect.flatMap((sent) => Ref.set(stateRef, sent)),
              )
            }
            return
          }

          case "Release": {
            const current = HashMap.get(state.records, event.identity)
            if (Option.isNone(current)) return
            const consumers = Chunk.filter(
              current.value.consumers,
              (consumer) => consumer.id !== event.consumerId,
            )
            if (Chunk.isNonEmpty(consumers)) {
              const record = { ...current.value, consumers }
              yield* Ref.set(stateRef, {
                ...state,
                records: HashMap.set(state.records, event.identity, record),
                orderedRecords: replaceOrderedRecord(state.orderedRecords, current.value, record),
              })
              return
            }

            const next = {
              ...state,
              records: HashMap.remove(state.records, event.identity),
              orderedRecords: Chunk.filter(
                state.orderedRecords,
                (record) => record !== current.value,
              ),
            }
            yield* Ref.set(stateRef, next)
            if (current.value.definition.unsubscribe) {
              yield* sendControl(next, current.value.definition.unsubscribe()).pipe(
                Effect.flatMap((sent) => Ref.set(stateRef, sent)),
              )
            }
            return
          }

          case "Connected": {
            let next = { ...state, connection: Option.some(event.connection) }
            yield* Ref.set(stateRef, next)
            for (const record of next.orderedRecords) {
              if (record.definition.subscribe) {
                next = yield* sendControl(next, record.definition.subscribe())
                yield* Ref.set(stateRef, next)
              }
              if (Option.isNone(next.connection)) break
            }
            return
          }

          case "Disconnected": {
            if (Option.isSome(state.connection) && state.connection.value === event.connection) {
              yield* Ref.set(stateRef, { ...state, connection: Option.none() })
            }
          }
        }
      })

    yield* Queue.take(events).pipe(Effect.flatMap(handleEvent), Effect.forever, Effect.forkScoped)

    const stream: SubscriptionManager["stream"] = (protocol, definition) =>
      Stream.unwrapScoped(
        Effect.uninterruptible(
          Effect.gen(function* () {
            const messages = yield* Queue.sliding<unknown>(1)
            const consumer: Consumer = { id: {}, messages }
            yield* Effect.addFinalizer(() =>
              Queue.shutdown(messages).pipe(
                Effect.zipRight(
                  Queue.offer(events, {
                    type: "Release",
                    identity: definition.identity,
                    consumerId: consumer.id,
                  }),
                ),
                Effect.asVoid,
              ),
            )
            yield* Queue.offer(events, {
              type: "Acquire",
              identity: definition.identity,
              protocol,
              definition,
              consumer,
            })
            return Stream.fromQueue(messages) as Stream.Stream<never>
          }),
        ),
      )

    const match: SubscriptionManager["match"] = (parsed) =>
      Ref.get(stateRef).pipe(
        Effect.map((state) => {
          for (const record of state.orderedRecords) {
            if (record.protocol.match(parsed, record.identity)) {
              return Option.some({
                protocol: record.protocol,
                identity: record.identity,
                publish: (message) =>
                  Effect.forEach(
                    record.consumers,
                    (consumer) => Queue.offer(consumer.messages, message),
                    { discard: true },
                  ),
              })
            }
          }
          return Option.none()
        }),
      )

    const runConnection: SubscriptionManager["runConnection"] = (send) =>
      Effect.gen(function* () {
        const failed = yield* Deferred.make<void, Socket.SocketError>()
        const connection: ConnectionEpoch = { send, failed }
        yield* Queue.offer(events, { type: "Connected", connection })
        yield* Effect.addFinalizer(() =>
          Queue.offer(events, { type: "Disconnected", connection }).pipe(Effect.asVoid),
        )
        return yield* Deferred.await(failed)
      })

    return { stream, match, runConnection }
  })
