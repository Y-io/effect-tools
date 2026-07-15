import * as Socket from "@effect/platform/Socket"
import { Effect, Either, Option, Schema, Stream } from "effect"
import type { ParseResult, Scope } from "effect"
import type { AnyProtocolDefinition } from "./protocol"
import { makeSubscriptionManager } from "./subscription-manager"
import { makeWebSocketConnection } from "./websocket-connection"

type ProtocolStream<Protocol> = Protocol extends {
  readonly schema: infer MessageSchema extends Schema.Schema.AnyNoContext
  readonly subscriptionSchema: infer SubscriptionSchema extends Schema.Schema.AnyNoContext
}
  ? {
      readonly stream: (
        params: Schema.Schema.Encoded<SubscriptionSchema>,
      ) => Stream.Stream<Schema.Schema.Type<MessageSchema>, ParseResult.ParseError>
    }
  : never

/** 从协议目录生成的业务 Stream API。 */
export type SocketClient<Catalog extends Readonly<Record<string, AnyProtocolDefinition>>> = {
  readonly [Key in keyof Catalog]: ProtocolStream<Catalog[Key]>
}

/** 组装 Socket Client 所需的不可变协议、底层 Socket 与 raw frame parser。 */
export interface SocketClientOptions<
  Catalog extends Readonly<Record<string, AnyProtocolDefinition>>,
> {
  readonly catalog: Catalog
  /** 可重复运行的 Effect Socket；每次重连会从它创建新的 connection epoch。 */
  readonly socket: Socket.Socket
  /**
   * 同步解析 raw frame。直接传入 JSON.parse 时只处理文本帧，二进制帧会被丢弃；
   * 需要处理二进制帧时应提供接受完整 frame 联合类型的 parser。
   */
  readonly parser: typeof JSON.parse | ((frame: string | Uint8Array) => unknown)
}

const reconnectDelay = "3 seconds"

type FrameParser = (frame: string | Uint8Array) => unknown

/**
 * 创建受 Scope 管理的 Socket Client。
 *
 * 构造本身不等待首次连接成功；后台连接循环会在失败或断线后三秒继续尝试，直至 Scope 结束。
 * parser 异常、无匹配消息及 Schema 解码失败都只丢弃当前 frame。
 */
export const makeSocketClient = <
  const Catalog extends Readonly<Record<string, AnyProtocolDefinition>>,
>(
  options: SocketClientOptions<Catalog>,
): Effect.Effect<SocketClient<Catalog>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const manager = yield* makeSubscriptionManager()

    /** 解析、首匹配、Schema 解码并发布单个 frame；parser 与解码失败在此隔离。 */
    const handleFrame = (frame: string | Uint8Array) =>
      Effect.sync(() => {
        try {
          if (typeof frame === "string") {
            return Option.some(options.parser(frame))
          }
          return options.parser === JSON.parse
            ? Option.none()
            : Option.some((options.parser as FrameParser)(frame))
        } catch {
          return Option.none()
        }
      }).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.void,
            onSome: (parsed) =>
              manager.match(parsed).pipe(
                Effect.flatMap(
                  Option.match({
                    onNone: () => Effect.void,
                    onSome: (target) => {
                      const decoded = Schema.decodeUnknownEither(target.protocol.schema)(parsed)
                      return Either.match(decoded, {
                        onLeft: () => Effect.void,
                        onRight: target.publish,
                      })
                    },
                  }),
                ),
              ),
          }),
        ),
      )

    /** 运行一个完整 connection epoch，连接终止或控制消息发送失败时结束。 */
    const runAttempt = Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* makeWebSocketConnection(options.socket)
        yield* Stream.runForEach(connection.frames, handleFrame).pipe(Effect.forkScoped)
        yield* Effect.raceFirst(
          connection.termination,
          manager.runConnection(connection.send),
        ).pipe(Effect.tapError(() => connection.close))
      }),
    )

    // 每次 attempt 都有独立 Scope，确保重试前关闭旧连接并遗弃旧控制队列。
    yield* runAttempt.pipe(
      Effect.catchAll(() => Effect.void),
      Effect.zipRight(Effect.sleep(reconnectDelay)),
      Effect.forever,
      Effect.forkScoped,
    )

    // 运行时按目录生成属性；末端断言只恢复 Object.fromEntries 擦除的 mapped type。
    const client = Object.fromEntries(
      Object.entries(options.catalog).map(([protocolKey, protocol]) => [
        protocolKey,
        {
          stream: (params: unknown) =>
            Stream.unwrap(
              Schema.decodeUnknown(protocol.subscriptionSchema)(params).pipe(
                Effect.map((decoded) =>
                  manager.stream(protocol, protocol.subscription(decoded as never)),
                ),
              ),
            ),
        },
      ]),
    )

    return client as unknown as SocketClient<Catalog>
  })
