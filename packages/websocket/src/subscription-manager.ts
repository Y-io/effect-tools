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
import type { SubscriptionDefinition } from "./protocol"

interface MessageProtocol<MessageSchema extends Schema.Schema.AnyNoContext> {
  readonly schema: MessageSchema
  readonly match: (parsed: unknown, identity: string) => boolean
}

/** 当前活跃订阅实例的期望状态；不绑定任何具体连接。 */
interface SubscriptionRecord {
  readonly protocolKey: string
  readonly protocol: MessageProtocol<Schema.Schema.AnyNoContext>
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
  readonly connection: Option.Option<ConnectionEpoch>
}

/** 仅属于一次连接的控制消息队列；断线后不可复用。 */
interface ConnectionEpoch {
  readonly controls: Queue.Queue<string>
}

export interface SubscriptionMatch {
  /** 命中实例所属的协议目录键。 */
  readonly protocolKey: string
  /** 命中实例共享的协议定义，用于上层执行 Schema 解码。 */
  readonly protocol: MessageProtocol<Schema.Schema.AnyNoContext>
  /** 命中实例的内部标识。 */
  readonly identity: string
  /** 将上层完成 Schema 解码后的消息广播给匹配的订阅实例。 */
  readonly publish: (message: unknown) => Effect.Effect<void>
}

export interface SubscriptionManager {
  /** 为协议键与订阅定义取得受 Scope 管理的共享消息流。 */
  readonly stream: <MessageSchema extends Schema.Schema.AnyNoContext>(
    protocolKey: string,
    protocol: MessageProtocol<MessageSchema>,
    definition: SubscriptionDefinition,
  ) => Stream.Stream<Schema.Schema.Type<MessageSchema>>
  /** 按稳定创建顺序查找首个粗匹配的活跃订阅实例。 */
  readonly match: (parsed: unknown) => Effect.Effect<Option.Option<SubscriptionMatch>>
  /** 在一个 connection epoch 内发送控制消息；Scope 结束会遗弃该 epoch 的队列。 */
  readonly runConnection: <E>(
    send: (control: string) => Effect.Effect<void, E>,
  ) => Effect.Effect<void, E, Scope.Scope>
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
  connection: state.connection,
})

/** 创建 scoped 订阅管理器；每个连接通过 runConnection 取得独立的 FIFO sender。 */
export const makeSubscriptionManager = (): Effect.Effect<SubscriptionManager, never, Scope.Scope> =>
  Effect.gen(function* () {
    const stateRef = yield* SynchronizedRef.make<SubscriptionState>({
      records: HashMap.empty(),
      orderedRecords: Chunk.empty(),
      connection: Option.none(),
    })

    yield* Effect.addFinalizer(() =>
      SynchronizedRef.getAndSet(stateRef, {
        records: HashMap.empty(),
        orderedRecords: Chunk.empty(),
        connection: Option.none(),
      }).pipe(
        Effect.flatMap((state) =>
          Effect.all(
            [
              ...Chunk.map(state.orderedRecords, (record) => PubSub.shutdown(record.messages)),
              ...Option.match(state.connection, {
                onNone: () => [],
                onSome: (connection) => [Queue.shutdown(connection.controls)],
              }),
            ],
            { discard: true },
          ),
        ),
      ),
    )

    /** 释放一个消费者引用，并在最后一个引用退出时移除实例和入队 unsubscribe。 */
    const release = (protocolKey: string, identity: string) => {
      const key = makeSubscriptionInstanceKey(protocolKey, identity)
      // 状态提交与可选 unsubscribe 入队不可被中断拆开，否则可能留下幽灵实例或漏发控制消息。
      return Effect.uninterruptible(
        SynchronizedRef.updateEffect(stateRef, (state) =>
          Effect.gen(function* () {
            const current = HashMap.get(state.records, key)
            if (Option.isNone(current)) return state

            if (current.value.references > 1) {
              return setRecord(state, key, current, {
                ...current.value,
                references: current.value.references - 1,
              })
            }

            if (current.value.definition.unsubscribe && Option.isSome(state.connection)) {
              yield* Queue.offer(
                state.connection.value.controls,
                current.value.definition.unsubscribe(),
              )
            }
            yield* PubSub.shutdown(current.value.messages)
            return {
              records: HashMap.remove(state.records, key),
              orderedRecords: Chunk.filter(
                state.orderedRecords,
                (candidate) => candidate !== current.value,
              ),
              connection: state.connection,
            }
          }),
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
                if (
                  Option.isNone(current) &&
                  definition.subscribe &&
                  Option.isSome(state.connection)
                ) {
                  yield* Queue.offer(state.connection.value.controls, definition.subscribe())
                }
                return [{ messages }, setRecord(state, key, current, record)] as const
              }),
            )

            return Stream.fromQueue(acquired.messages) as Stream.Stream<never>
          }),
        ),
      )
    }

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

    /**
     * 安装新 connection epoch，并按稳定创建顺序从当前期望状态重建 subscribe。
     * 唯一 sender 串行等待每次 send；send 失败原样结束本 Effect，交由 Socket Client 关闭连接。
     */
    const runConnection: SubscriptionManager["runConnection"] = (send) =>
      Effect.gen(function* () {
        const controls = yield* Queue.unbounded<string>()
        const connection: ConnectionEpoch = { controls }

        yield* SynchronizedRef.updateEffect(stateRef, (state) =>
          Effect.gen(function* () {
            for (const record of state.orderedRecords) {
              if (record.definition.subscribe) {
                yield* Queue.offer(controls, record.definition.subscribe())
              }
            }
            return { ...state, connection: Option.some(connection) }
          }),
        )

        yield* Effect.addFinalizer(() =>
          SynchronizedRef.updateEffect(stateRef, (state) =>
            Effect.gen(function* () {
              yield* Queue.shutdown(controls)
              return Option.isSome(state.connection) && state.connection.value === connection
                ? { ...state, connection: Option.none() }
                : state
            }),
          ),
        )

        return yield* Queue.take(controls).pipe(Effect.flatMap(send), Effect.forever)
      })

    return { stream, match, runConnection }
  })
