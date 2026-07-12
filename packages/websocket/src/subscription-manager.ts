import * as Socket from "@effect/platform/Socket"
import { Chunk, Deferred, Effect, HashMap, Option, Queue, Ref, Stream } from "effect"
import type { Schema, Scope } from "effect"
import type { SubscriptionDefinition } from "./protocol"

interface MessageProtocol<MessageSchema extends Schema.Schema.AnyNoContext> {
  readonly schema: MessageSchema
  readonly match: (parsed: unknown, identity: string) => boolean
}

/** 一次 Stream 消费的内部句柄；id 只用于精确关联对应的 Release。 */
interface Consumer {
  readonly id: object
  /** 每个消费者独立保留最新一条尚未消费的消息。 */
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
  /** 当前连接唯一允许使用的控制消息 sender。 */
  readonly send: (control: string) => Effect.Effect<void, Socket.SocketError>
  /** sender 失败时通知 Socket Client 关闭并重建连接。 */
  readonly failed: Deferred.Deferred<void, Socket.SocketError>
}

interface SubscriptionState {
  /** identity 索引用于 Acquire、Release 和消息归属。 */
  readonly records: HashMap.HashMap<string, SubscriptionRecord>
  /** 独立保留创建顺序，用于确定性的 first-match 路由和重连恢复。 */
  readonly orderedRecords: Chunk.Chunk<SubscriptionRecord>
  readonly connection: Option.Option<ConnectionEpoch>
}

/**
 * 所有订阅列表变更和连接切换都进入同一 FIFO Queue。
 * 事件不携带完成回执：Stream 只等待事件入队，不等待事件处理或远端发送。
 */
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

/**
 * 创建由单一事件 Fiber 维护订阅列表的 scoped Subscription Manager。
 * stateRef 向入站匹配暴露不可变快照，但只有事件 Fiber 和最终清理可以写入。
 */
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

    /** 串行应用一个订阅事件；该函数只由下方唯一事件 Fiber 调用。 */
    const handleEvent = (event: SubscriptionEvent) =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef)

        switch (event.type) {
          case "Acquire": {
            const current = HashMap.get(state.records, event.identity)
            if (Option.isSome(current)) {
              // identity 已存在时只增加本地消费者，不重复建立远端订阅。
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
            // 先发布本地订阅快照，再发送 subscribe，确保同步回包能够命中 consumer。
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
              // 仍有消费者时只更新成员集合，远端订阅继续存活。
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
            // 最后一个消费者退出时先删除本地记录，避免 unsubscribe 回包再次被路由。
            yield* Ref.set(stateRef, next)
            if (current.value.definition.unsubscribe) {
              yield* sendControl(next, current.value.definition.unsubscribe()).pipe(
                Effect.flatMap((sent) => Ref.set(stateRef, sent)),
              )
            }
            return
          }

          case "Connected": {
            // 新连接只从当前订阅列表恢复，不回放断线期间已经处理过的事件。
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
            // 旧 epoch 的迟到事件不能清除后来安装的新连接。
            if (Option.isSome(state.connection) && state.connection.value === event.connection) {
              yield* Ref.set(stateRef, { ...state, connection: Option.none() })
            }
          }
        }
      })

    // 唯一事件消费 Fiber 同时提供列表写入与控制消息发送的全局顺序。
    yield* Queue.take(events).pipe(Effect.flatMap(handleEvent), Effect.forever, Effect.forkScoped)

    const stream: SubscriptionManager["stream"] = (protocol, definition) =>
      Stream.unwrapScoped(
        Effect.uninterruptible(
          Effect.gen(function* () {
            // Stream 建立后立即可消费；Acquire 是否已处理只决定何时可能收到首条数据。
            const messages = yield* Queue.sliding<unknown>(1)
            const consumer: Consumer = { id: {}, messages }
            yield* Effect.addFinalizer(() =>
              // 本地数据 Queue 先关闭，Release 随后异步维护订阅列表和远端状态。
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
          // 一个 WebSocket 消息只归属首个匹配的订阅，再广播给该订阅的消费者。
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
        // race 中断本 Effect 时只提交 Disconnected；事件 Fiber 负责验证 epoch 身份。
        yield* Effect.addFinalizer(() =>
          Queue.offer(events, { type: "Disconnected", connection }).pipe(Effect.asVoid),
        )
        return yield* Deferred.await(failed)
      })

    return { stream, match, runConnection }
  })
