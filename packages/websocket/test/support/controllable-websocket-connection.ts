import { Deferred, Effect, Option, Queue, Ref, Stream } from "effect"
import type { Scope } from "effect"
import {
  makeWebSocketConnection,
  type WebSocketConnection,
  type WebSocketConnectionTermination,
} from "../../src/websocket-connection"

export interface ControllableWebSocketConnection<RawFrame, Control, SendError> {
  /** 被测业务只依赖这一生产接口，其余字段仅用于测试驱动 transport。 */
  readonly connection: WebSocketConnection<RawFrame, Control, SendError, never>
  readonly emitFrame: (frame: RawFrame) => Effect.Effect<void>
  readonly takeSent: Effect.Effect<Control>
  readonly failNextSend: (error: SendError) => Effect.Effect<void>
  readonly disconnect: (code?: number, reason?: string) => Effect.Effect<void>
}

/** 测试用的可控 connection epoch；业务代码仍通过 connection 公共接口消费。 */
export const makeControllableWebSocketConnection = <RawFrame, Control, SendError>(): Effect.Effect<
  ControllableWebSocketConnection<RawFrame, Control, SendError>,
  never,
  Scope.Scope
> =>
  Effect.gen(function* () {
    // fake 仍使用 Effect 通信原语，使取消、背压和 Scope 语义与生产边界一致。
    const frames = yield* Queue.unbounded<RawFrame>()
    const sent = yield* Queue.unbounded<Control>()
    // 失败只消费一次，下一条控制消息恢复正常发送，便于精确测试单次故障。
    const nextSendFailure = yield* Ref.make<Option.Option<SendError>>(Option.none())
    const termination = yield* Deferred.make<WebSocketConnectionTermination<never>>()
    yield* Effect.addFinalizer(() =>
      Effect.all([Queue.shutdown(frames), Queue.shutdown(sent)], { discard: true }),
    )

    // 把可控 transport adapter 交给同一个生产构造函数，而不是复制连接实现。
    const connection = yield* makeWebSocketConnection({
      frames: Stream.fromQueue(frames),
      write: (control: Control) =>
        Ref.getAndSet(nextSendFailure, Option.none()).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Queue.offer(sent, control).pipe(Effect.asVoid),
              onSome: Effect.fail,
            }),
          ),
        ),
      awaitTermination: Deferred.await(termination),
      close: Effect.void,
    })

    return {
      connection,
      emitFrame: (frame) => Queue.offer(frames, frame).pipe(Effect.asVoid),
      takeSent: Queue.take(sent),
      failNextSend: (error) => Ref.set(nextSendFailure, Option.some(error)),
      disconnect: (code, reason) =>
        Deferred.succeed(termination, { _tag: "RemoteClose", code, reason }).pipe(Effect.asVoid),
    }
  })
