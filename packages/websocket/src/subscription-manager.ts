import {
  Chunk,
  Data,
  Effect,
  HashMap,
  Option,
  PubSub,
  Queue,
  Stream,
  SynchronizedRef,
} from "effect"
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
  readonly references: number
}

interface SubscriptionInstanceKey {
  readonly protocolKey: string
  readonly identity: string
}

interface SubscriptionState {
  // 两个索引必须在同一次 SynchronizedRef 更新中变化，避免查找状态与路由顺序分叉。
  readonly records: HashMap.HashMap<SubscriptionInstanceKey, SubscriptionRecord>
  readonly orderedRecords: Chunk.Chunk<SubscriptionRecord>
}

export interface SubscriptionMatch {
  readonly protocolKey: string
  readonly protocol: ProtocolDefinition<Schema.Schema.Any>
  readonly identity: string
  /** 将上层完成 Schema 解码后的消息广播给匹配的订阅实例。 */
  readonly publish: (message: unknown) => Effect.Effect<void>
}

export interface SubscriptionManager {
  /** 为协议键与订阅定义取得受 Scope 管理的共享消息流。 */
  readonly stream: <MessageSchema extends Schema.Schema.Any>(
    protocolKey: string,
    protocol: ProtocolDefinition<MessageSchema>,
    definition: SubscriptionDefinition,
  ) => Stream.Stream<Schema.Schema.Type<MessageSchema>>
  /** 按协议键与 identity 向指定订阅实例广播消息。 */
  readonly publish: (protocolKey: string, identity: string, message: unknown) => Effect.Effect<void>
  /** 按稳定创建顺序查找首个粗匹配的活跃订阅实例。 */
  readonly match: (parsed: unknown) => Effect.Effect<Option.Option<SubscriptionMatch>>
}

/** 创建具有结构化相等语义的订阅实例组合键。 */
const makeSubscriptionInstanceKey = (
  protocolKey: string,
  identity: string,
): SubscriptionInstanceKey =>
  // Data.struct 提供结构化 Equal / Hash，使每次新建的组合键仍能命中同一 HashMap 条目。
  Data.struct({ protocolKey, identity })

/** 写入订阅记录，同时保持既有实例在稳定路由顺序中的位置。 */
const setRecord = (
  state: SubscriptionState,
  key: SubscriptionInstanceKey,
  previous: Option.Option<SubscriptionRecord>,
  record: SubscriptionRecord,
): SubscriptionState => ({
  records: HashMap.set(state.records, key, record),
  orderedRecords: Option.match(previous, {
    onNone: () => Chunk.append(state.orderedRecords, record),
    // 引用数变化只替换原位置，不能把既有实例移到路由顺序末尾。
    onSome: (current) =>
      Chunk.map(state.orderedRecords, (candidate) => (candidate === current ? record : candidate)),
  }),
})

/** 创建 scoped 订阅管理器，并启动唯一的 FIFO 控制消息 sender。 */
export const makeSubscriptionManager = (
  writeControl: (control: SubscriptionControl) => Effect.Effect<void>,
): Effect.Effect<SubscriptionManager, never, Scope.Scope> =>
  Effect.gen(function* () {
    const controlQueue = yield* Queue.unbounded<SubscriptionControl>()
    const stateRef = yield* SynchronizedRef.make<SubscriptionState>({
      records: HashMap.empty(),
      orderedRecords: Chunk.empty(),
    })

    yield* Effect.addFinalizer(() => Queue.shutdown(controlQueue))
    // 只有这个 scoped Fiber 可以调用 writeControl；Queue 同时提供全局 FIFO 顺序。
    yield* Queue.take(controlQueue).pipe(
      Effect.flatMap(writeControl),
      Effect.forever,
      Effect.forkScoped,
    )

    /** 释放一个消费者引用，并在最后一个引用退出时移除实例和入队 unsubscribe。 */
    const release = (protocolKey: string, identity: string) => {
      const key = makeSubscriptionInstanceKey(protocolKey, identity)
      // 状态提交与可选 unsubscribe 入队不可被中断拆开，否则可能留下幽灵实例或漏发控制消息。
      return Effect.uninterruptible(
        SynchronizedRef.modify(stateRef, (state) => {
          const current = HashMap.get(state.records, key)
          if (Option.isNone(current)) return [Option.none(), state] as const

          if (current.value.references > 1) {
            const record = { ...current.value, references: current.value.references - 1 }
            return [Option.none(), setRecord(state, key, current, record)] as const
          }

          return [
            Option.fromNullable(current.value.definition.unsubscribe),
            {
              records: HashMap.remove(state.records, key),
              orderedRecords: Chunk.filter(
                state.orderedRecords,
                (candidate) => candidate !== current.value,
              ),
            },
          ] as const
        }).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.void,
              onSome: (control) => Queue.offer(controlQueue, control).pipe(Effect.asVoid),
            }),
          ),
        ),
      )
    }

    /** 建立或复用订阅实例，并返回该实例的独立消费者 Stream。 */
    const stream: SubscriptionManager["stream"] = (protocolKey, protocol, definition) => {
      const key = makeSubscriptionInstanceKey(protocolKey, definition.identity)
      return Stream.unwrapScoped(
        // 先原子建立实例、广播订阅和 finalizer，再入队 subscribe，保证即时响应不会丢失。
        Effect.uninterruptible(
          Effect.gen(function* () {
            const acquired = yield* SynchronizedRef.modifyEffect(stateRef, (state) =>
              Effect.gen(function* () {
                const current = HashMap.get(state.records, key)
                const record = Option.isSome(current)
                  ? { ...current.value, references: current.value.references + 1 }
                  : {
                      protocolKey,
                      protocol,
                      definition,
                      messages: yield* PubSub.sliding<unknown>(1),
                      references: 1,
                    }
                const messages = yield* PubSub.subscribe(record.messages)
                yield* Effect.addFinalizer(() => release(protocolKey, definition.identity))
                return [
                  {
                    messages,
                    subscribe: Option.isNone(current)
                      ? Option.fromNullable(definition.subscribe)
                      : Option.none(),
                  },
                  setRecord(state, key, current, record),
                ] as const
              }),
            )

            if (Option.isSome(acquired.subscribe)) {
              yield* Queue.offer(controlQueue, acquired.subscribe.value)
            }

            return Stream.fromQueue(acquired.messages) as Stream.Stream<never>
          }),
        ),
      )
    }

    /** 查找指定实例并广播已解码消息；实例不存在时安静丢弃。 */
    const publish: SubscriptionManager["publish"] = (protocolKey, identity, message) =>
      Effect.gen(function* () {
        const state = yield* SynchronizedRef.get(stateRef)
        const record = HashMap.get(
          state.records,
          makeSubscriptionInstanceKey(protocolKey, identity),
        )
        if (Option.isSome(record)) yield* PubSub.publish(record.value.messages, message)
      })

    /** 在当前不可变状态快照中执行确定性的首匹配路由。 */
    const match: SubscriptionManager["match"] = (parsed) =>
      SynchronizedRef.get(stateRef).pipe(
        Effect.map((state) => {
          // 不在 matcher 执行期间持锁；不可变快照仍保持本次路由的稳定创建顺序。
          for (const record of state.orderedRecords) {
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
        }),
      )

    return { stream, publish, match }
  })
