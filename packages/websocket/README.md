# WebSocket

`@pkg/websocket` 用不可变的协议目录描述入站消息，并生成类型安全的业务 `Stream` API。业务代码只需要定义消息如何匹配、如何解码，以及如何生成订阅信息；连接、重连和订阅生命周期由 `Socket Client` 统一管理。

## 浏览器示例

下面的示例订阅 `BTC-USDT` 的 `1m` 和 `3m` 行情。示例服务端接受以下控制消息：

```json
{"op":"subscribe","channel":"ticker","symbol":"BTC-USDT","interval":"1m"}
```

并返回以下入站消息：

```json
{"type":"ticker","symbol":"BTC-USDT","interval":"1m","price":65000,"timestamp":1784116800000}
```

协议目录负责把业务参数转换为订阅实例，并从入站消息中找出对应的实例：

```ts
import * as Socket from "@effect/platform/Socket"
import { Effect, Schema, Stream } from "effect"
import { defineProtocol, defineProtocolCatalog, makeSocketClient } from "@pkg/websocket"

type Interval = "1m" | "3m"

const TickerParams = Schema.parseJson(
  Schema.Struct({
    symbol: Schema.String,
    interval: Schema.Literal("1m", "3m"),
  }),
)

const tickerIdentity = (symbol: string, interval: Interval) =>
  `ticker:${symbol}:${interval}`

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const catalog = defineProtocolCatalog({
  ticker: defineProtocol({
    schema: Schema.Struct({
      type: Schema.Literal("ticker"),
      symbol: Schema.String,
      interval: Schema.Literal("1m", "3m"),
      price: Schema.Number,
      timestamp: Schema.Number,
    }),

    // stream 接收 JSON 字符串，解码成功后才建立订阅实例。
    subscriptionSchema: TickerParams,

    // match 只判断消息是否属于当前订阅实例，完整校验由 schema 负责。
    match: (parsed, identity) =>
      isRecord(parsed) &&
      parsed.type === "ticker" &&
      typeof parsed.symbol === "string" &&
      (parsed.interval === "1m" || parsed.interval === "3m") &&
      tickerIdentity(parsed.symbol, parsed.interval) === identity,

    subscription: ({ symbol, interval }) => ({
      // identity 在整个协议目录内必须全局唯一。
      identity: tickerIdentity(symbol, interval),
      subscribe: () =>
        JSON.stringify({
          op: "subscribe",
          channel: "ticker",
          symbol,
          interval,
        }),
      unsubscribe: () =>
        JSON.stringify({
          op: "unsubscribe",
          channel: "ticker",
          symbol,
          interval,
        }),
    }),
  }),
})

const tickerParams = (symbol: string, interval: Interval) =>
  JSON.stringify({ symbol, interval })

const program = Effect.scoped(
  Effect.gen(function* () {
    const socket = yield* Socket.makeWebSocket("wss://example.com/market")
    const client = yield* makeSocketClient({
      catalog,
      socket,
      parser: JSON.parse,
    })

    yield* Effect.all(
      [
        client.ticker.stream(tickerParams("BTC-USDT", "1m")).pipe(
          Stream.runForEach((message) =>
            Effect.sync(() => console.log("1m", message)),
          ),
        ),
        client.ticker.stream(tickerParams("BTC-USDT", "3m")).pipe(
          Stream.runForEach((message) =>
            Effect.sync(() => console.log("3m", message)),
          ),
        ),
      ],
      { concurrency: "unbounded" },
    )
  }),
).pipe(Effect.provide(Socket.layerWebSocketConstructorGlobal))

// 在浏览器应用的 Effect 入口运行；程序取消或结束时，Scope 自动释放资源。
Effect.runPromise(program)
```

`subscriptionSchema` 的 encoded 类型会成为对应 `stream` 方法的参数类型。上例使用 `Schema.parseJson(...)`，因此生成的 API 接收 JSON 字符串：

```ts
client.ticker.stream(
  JSON.stringify({
    symbol: "BTC-USDT",
    interval: "1m",
  }),
)
```

`1m` 与 `3m` 会生成不同的 `identity`，所以它们是相互隔离的订阅实例。服务端入站消息必须包含足以还原该 `identity` 的字段；如果服务端不返回 `interval`，客户端就无法据此区分两个周期，此时应使用服务端提供的频道 ID 等稳定路由字段。

## 在 React 中维护行情状态

React 应用可以使用 Effect Atom 把业务 Stream 转换为组件所需的最新值状态：

```sh
bun add @effect-atom/atom-react
```

以下示例沿用上文的 `catalog` 和 `Interval`。在 React 应用中，用一个共享的 Atom runtime 管理 `Socket Client`，不要再单独运行上文的 `program`，否则会建立两套连接。

```tsx
import { Atom } from "@effect-atom/atom-react"
import * as Socket from "@effect/platform/Socket"
import { Context, Effect, Layer, Stream } from "effect"
import { makeSocketClient, type SocketClient } from "@pkg/websocket"

class MarketClient extends Context.Tag("example/MarketClient")<
  MarketClient,
  SocketClient<typeof catalog>
>() {}

const MarketClientLive = Layer.scoped(
  MarketClient,
  Effect.gen(function* () {
    const socket = yield* Socket.makeWebSocket("wss://example.com/market")
    return yield* makeSocketClient({
      catalog,
      socket,
      parser: JSON.parse,
    })
  }),
).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal))

const marketRuntime = Atom.runtime(MarketClientLive)

const tickerStream = (params: string) =>
  Stream.unwrap(
    Effect.map(MarketClient, (client) => client.ticker.stream(params)),
  )
```

`MarketClientLive` 的 Scope 归 Atom runtime 管理。所有行情 Atom 共用同一个 `Socket Client`，因此也共用它维护的连接、重连和订阅实例。

### 维护单个行情

固定业务参数可以直接定义为一个 Atom：

```tsx
import { Result, useAtomValue } from "@effect-atom/atom-react"

const btcOneMinuteAtom = marketRuntime.atom(
  tickerStream(tickerParams("BTC-USDT", "1m")),
)

export function BtcOneMinuteTicker() {
  const result = useAtomValue(btcOneMinuteAtom)

  return Result.builder(result)
    .onInitial(() => <span>等待 BTC-USDT 1m 行情...</span>)
    .onFailure(() => <span>BTC-USDT 1m 行情不可用</span>)
    .onSuccess((ticker) => <span>{ticker.price}</span>)
    .render()
}
```

`BtcOneMinuteTicker` 挂载后，Atom 开始消费对应的 `client.ticker.stream(params)` 并保存最新一条消息。组件卸载且没有其他消费者时，Atom 自动释放 Stream；如果这是该订阅实例的最后一个消费者，`Socket Client` 会发送对应的 `unsubscribe`。

### 维护多个行情

业务参数在运行时确定时，使用 `Atom.family` 为每组参数取得稳定的 Atom。family key 使用 `tickerParams` 生成的规范 JSON 字符串；相同参数会得到相同字符串，不依赖对象引用：

```tsx
import { Atom, Result, useAtomValue } from "@effect-atom/atom-react"

const tickerAtom = Atom.family((params: string) =>
  marketRuntime.atom(tickerStream(params)),
)

interface TickerCardProps {
  readonly symbol: string
  readonly interval: Interval
}

function TickerCard({ symbol, interval }: TickerCardProps) {
  const result = useAtomValue(tickerAtom(tickerParams(symbol, interval)))

  return Result.builder(result)
    .onInitial(() => <li>等待 {symbol} {interval} 行情...</li>)
    .onFailure(() => <li>{symbol} {interval} 行情不可用</li>)
    .onSuccess((ticker) => (
      <li>
        {ticker.symbol} {ticker.interval}: {ticker.price}
      </li>
    ))
    .render()
}

const subscriptions = [
  { symbol: "BTC-USDT", interval: "1m" },
  { symbol: "BTC-USDT", interval: "3m" },
  { symbol: "ETH-USDT", interval: "1m" },
] as const

export function TickerDashboard() {
  return (
    <ul>
      {subscriptions.map(({ symbol, interval }) => (
        <TickerCard
          key={`${symbol}:${interval}`}
          symbol={symbol}
          interval={interval}
        />
      ))}
    </ul>
  )
}
```

每个 JSON 参数字符串都有独立的最新值状态和订阅生命周期。相同参数的多个组件会取得同一个 Atom，并复用同一个远端订阅；不同参数会得到相互隔离的订阅实例。移除一个 `TickerCard` 只会结束该组件对 Atom 的使用；仅当最后一个相同参数的组件卸载时才释放对应 Stream，不影响 Dashboard 中的其他行情。

这些行情 Atom 不使用 `Atom.keepAlive`。没有组件使用某个 Atom 时，应让它释放 Stream，使 `Socket Client` 能够自动结束不再需要的远端订阅。

## 自动生命周期

- `makeSocketClient` 在当前 `Scope` 内自动维护连接；构造过程不等待首次连接成功。
- 消费业务 Stream 时先用协议的 `subscriptionSchema` 解码参数；失败时以 `ParseError` 结束该 Stream，不建立订阅实例。
- 消费 `client.ticker.stream(...)` 时自动建立本地消费者。连接可用后，第一个消费者会触发对应的 `subscribe`。
- 相同 `identity` 的多个消费者共享一个远端订阅，但各自都能消费同一条最新消息。
- 消费者结束或被取消时自动释放；最后一个消费者退出后触发对应的 `unsubscribe`。
- 连接断开后，当前活跃订阅会保留。客户端每三秒尝试重连，并在重连后恢复这些订阅。
- 外层 `Scope` 结束时自动停止重连，并释放连接和全部订阅资源。调用方不需要自行发送控制消息或维护连接状态。

共享消息流不保留历史，也不是无损事件队列。慢消费者只保留尚未消费的最新一条消息。

## 协议定义规则

### `subscriptionSchema`

`subscriptionSchema` 定义 `stream(...)` 接收的 encoded 参数及其运行时校验。使用 `Schema.parseJson(...)` 时，`stream` 接收 JSON 字符串，解码成功后才把业务对象交给 `subscription`。调用方应使用统一的 helper 生成 JSON，以保证语义相同的参数也具有相同的 Atom family key。

### `identity`

`identity` 同时用于消息路由和订阅生命周期，并且必须在整个协议目录内全局唯一。建议包含协议前缀和全部路由参数，例如 `ticker:BTC-USDT:1m`。

### `match` 与 `schema`

`match(parsed, identity)` 对 parser 的不可信输出执行安全的粗匹配，只负责确定消息属于哪个订阅实例。首个命中的实例获得该消息，然后才使用所属协议的 `schema` 解码完整内容。

不要在 `match` 中重复完整数据校验。parser 抛出异常、消息没有命中活跃订阅或 Schema 解码失败时，客户端只丢弃当前 frame，不会终止连接或业务 Stream。

### `parser`

`parser` 是同步的 raw frame 解析函数。普通 JSON 文本协议可以直接传入 `JSON.parse`；此时二进制 frame 会被丢弃。需要处理二进制消息时，应提供接受 `string | Uint8Array` 的自定义 parser。

### 可选控制消息

`subscribe` 和 `unsubscribe` 都是可选的。只被动接收入站消息的协议可以只返回 `identity`，仍然通过相同的 `stream(...)` API 消费消息。
