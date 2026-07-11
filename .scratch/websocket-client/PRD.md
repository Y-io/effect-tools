# Effect WebSocket Client

Status: ready-for-agent

## Problem Statement

业务需要在 Effect v3 中复用一套 WebSocket 客户端架构：以声明式协议配置描述消息匹配、Schema 解码以及订阅信息生成；多个调用方可以按业务参数取得相互隔离、可重复消费的最新值 Stream；客户端统一维护连接、订阅引用计数、发送顺序和断线重订阅。

如果每个业务自行管理 WebSocket、订阅列表、消息分发和重连，容易出现重复订阅、取消订阅过早、首条消息丢失、发送乱序、断线后状态与远端不一致，以及多个消费者相互抢消息等问题。

## Solution

提供一组可独立组装的 Effect v3 服务：不可变的协议目录、底层 WebSocket 连接、订阅管理器，以及面向业务的 Socket Client。

业务通过协议配置声明：

- 必需的粗匹配函数；它结合已解析的入站消息和订阅实例的 `identity` 判断消息是否属于该实例。
- 必需的 Effect Schema；它解码解析后的完整入站消息。
- 必需的订阅工厂；它根据 `stream(...args)` 的业务参数生成唯一字符串 `identity`，并可选生成 subscribe 与 unsubscribe 控制消息。

业务调用 `client.<protocol>.stream(...args)` 取得只包含 Schema 解码结果的 Stream。Socket Client 在内部按协议配置与 `identity` 维护订阅实例、引用计数和最新值广播。调用方无需接触 identity、订阅控制消息、连接状态或重连过程。

## User Stories

1. As a WebSocket business developer, I want to declare all supported message types in one protocol catalog, so that protocol behavior is visible and type-safe.
2. As a WebSocket business developer, I want every protocol definition to require a Schema, so that untrusted inbound data is decoded before reaching consumers.
3. As a WebSocket business developer, I want to supply the raw-frame parser explicitly, so that the client does not assume JSON or a particular frame representation.
4. As a WebSocket business developer, I want to pass `JSON.parse` directly as the parser, so that ordinary JSON WebSocket protocols remain simple to configure.
5. As a WebSocket business developer, I want each protocol to define a coarse matcher, so that unrelated WebSocket messages are ignored.
6. As a WebSocket business developer, I want the matcher to receive the current subscription identity, so that one protocol can maintain multiple isolated subscriptions.
7. As a WebSocket business developer, I want matching to stop at the first active subscription instance that matches, so that routing is deterministic and inexpensive.
8. As a WebSocket business developer, I want a subscription factory to derive a unique identity from multiple business parameters, so that callers do not manually construct routing keys.
9. As a WebSocket business developer, I want the same subscription factory result to contain both subscribe and unsubscribe messages, so that both operations necessarily use the same identity.
10. As a WebSocket business developer, I want subscribe and unsubscribe messages to be optional, so that passively received data uses the same Stream API as actively subscribed data.
11. As a Stream consumer, I want to request data using only business parameters, so that identity and WebSocket protocol details remain internal.
12. As a Stream consumer, I want the Stream to contain only Schema-decoded business messages, so that I never process raw frames.
13. As a Stream consumer, I want multiple consumers of the same protocol and identity to receive the same live message, so that consumers do not compete for values.
14. As a Stream consumer, I want a newly attached consumer to receive only messages arriving after it attaches, so that historical values are never replayed.
15. As a Stream consumer, I want slow consumption to retain only the newest pending value, so that stale intermediate updates do not accumulate.
16. As a Stream consumer, I want different identities under the same protocol to be isolated, so that one business subscription never receives another subscription's data.
17. As a Stream consumer, I want repeated consumption of the same protocol and identity to share one remote subscription, so that the server is not subscribed repeatedly.
18. As a Stream consumer, I want the remote subscription to remain active while at least one local consumer exists, so that one consumer cannot cancel another consumer's data.
19. As a Stream consumer, I want the remote subscription to be cancelled after the final local consumer exits, so that unused server resources are released.
20. As a Stream consumer, I want fiber interruption and Scope finalization to release subscription references automatically, so that failed or cancelled consumers do not leak subscriptions.
21. As a WebSocket business developer, I want the local subscription model established before subscribe is sent, so that an immediate server response cannot be lost during setup.
22. As a WebSocket business developer, I want all subscription lifecycle mutations serialized, so that concurrent acquire and release operations cannot corrupt reference counts or send duplicate controls.
23. As a WebSocket business developer, I want all subscribe and unsubscribe messages sent through one FIFO queue, so that WebSocket writes preserve lifecycle order.
24. As a WebSocket business developer, I want the subscription manager to be the only writer of subscription control messages, so that no caller can bypass ordering guarantees.
25. As a WebSocket business developer, I want malformed raw frames discarded without terminating the connection, so that one bad message does not disrupt valid traffic.
26. As a WebSocket business developer, I want messages that match no active subscription discarded, so that the client processes only configured and currently requested data.
27. As a WebSocket business developer, I want Schema decode failures discarded without terminating Streams or the connection, so that invalid business data is isolated to one message.
28. As a WebSocket business developer, I want connection loss to clear the obsolete outbound queue, so that stale control commands are not replayed against a new connection.
29. As a WebSocket business developer, I want active local subscription records retained across connection loss, so that desired subscriptions survive reconnects.
30. As a WebSocket business developer, I want reconnect to rebuild remote subscriptions from current local records, so that transient acquire and release commands from the disconnected period are collapsed into current state.
31. As a WebSocket business developer, I want reconnect attempts to continue every three seconds while the Socket Client Scope remains alive, so that temporary outages recover without caller intervention.
32. As a WebSocket business developer, I want a subscription-control send failure to invalidate the connection immediately, so that uncertain connection state is recovered through a clean reconnect.
33. As a WebSocket business developer, I want closing the Socket Client Scope to stop reconnecting and release all resources, so that application shutdown is deterministic.

## Implementation Decisions

- The protocol catalog is immutable after Socket Client initialization. Each protocol has a unique catalog key and one shared Schema.
- A protocol definition contains a required `match(parsed, identity): boolean`, a required Schema for the complete parsed inbound value, and a required subscription factory.
- The subscription factory accepts the same business arguments exposed by the generated `stream(...args)` API.
- The subscription factory returns a string identity plus optional subscribe and unsubscribe control messages. Identity is an internal routing and lifecycle key and is never required from Stream consumers directly.
- The combination of protocol key and identity uniquely identifies a subscription instance. Repeated consumers reuse the existing instance instead of copying the protocol definition or Schema.
- A subscription record stores the identity, a reference to its protocol definition, its current reference count, and its latest-value broadcast source.
- The required frame parser is a synchronous function from the raw WebSocket frame to `unknown`. The Socket Client catches parser exceptions and discards only the current frame.
- Inbound routing iterates active subscription records in stable creation order. Each record invokes its referenced protocol match function with the parsed value and that record's identity. The first `true` result wins.
- After a subscription record matches, its Schema decodes the complete parsed value. A decode failure discards the current message. A successful result is broadcast only to that subscription instance.
- The shared message source uses Effect `PubSub.sliding(1)` with no replay. Active consumers receive live broadcasts; slow consumers retain only the newest pending value; later consumers do not receive earlier values.
- Subscription acquisition is tied to Stream consumption and Effect Scope. The local subscription record and consumer broadcast subscription are established before any remote subscribe control message is sent.
- Reference-count transitions and subscription-control sends are serialized by the subscription manager.
- A transition from zero to one active consumer enqueues the optional subscribe message. Additional consumers only increment the reference count.
- A transition from one to zero active consumers enqueues the optional unsubscribe message and removes the inactive subscription from desired local state in lifecycle order.
- The subscription manager is the sole writer of subscribe and unsubscribe control messages. It owns one FIFO outbound queue and one ordered sending process.
- The first version has no general-purpose business-message send API and no heartbeat facility.
- Connection loss clears the outbound control queue but preserves subscription records whose reference count remains above zero.
- After connection establishment, the subscription manager enqueues subscribe messages for all currently active subscription records in stable record order.
- A control-message send failure immediately invalidates and closes the current connection, clears its queue, and starts reconnect behavior.
- Reconnect retries indefinitely at a fixed three-second interval while the Socket Client Scope remains alive. The first version does not expose a configurable Effect Schedule.
- Socket Client Scope finalization stops reconnect attempts, closes the current connection, shuts down queues and broadcasts, and clears subscription state.
- The Socket Client owns the lifecycles of the protocol catalog, subscription manager, and WebSocket connection resources that it composes.

## Testing Decisions

- Tests should exercise the public Socket Client `stream(...args)` behavior through a controllable fake WebSocket connection and Effect test clock. Internal queues, maps, fibers, and raw reference-count fields should not be asserted directly.
- The primary test seam is a fully assembled Socket Client with a small protocol catalog, a deterministic parser, a fake connection capable of emitting frames and failures, and observable sent control messages.
- Verify that the first consumer creates local routing before subscribe is sent, and that an immediate response is observable by that consumer.
- Verify that multiple consumers for the same protocol and identity produce one subscribe, receive the same live value, and produce one unsubscribe only after the final consumer exits.
- Verify that different identities under one protocol route to different Streams through `match(parsed, identity)`.
- Verify first-match-wins behavior using overlapping subscription matchers and stable subscription creation order.
- Verify Schema decoding of the complete parsed message and discard behavior for parser failures, unmatched messages, and Schema failures.
- Verify latest-value semantics by pausing a consumer, publishing multiple values, and asserting that only the newest pending value remains.
- Verify that a newly attached consumer receives no previously published value.
- Verify passive subscriptions whose factory produces identity without control messages.
- Verify concurrent consumer acquisition and release cannot duplicate subscribe/unsubscribe messages or produce an invalid lifecycle order.
- Verify disconnect clears unsent control messages while retaining active desired subscriptions.
- Verify reconnect after three seconds recreates only currently active subscriptions, not stale queued transitions.
- Verify control-message send failure closes the connection and starts the same reconnect path.
- Verify Scope finalization stops future reconnect attempts and releases all Stream and connection resources.
- There is no existing WebSocket package test prior art in the repository; tests should follow Effect v3 Scope, PubSub, Stream, and TestClock patterns from the vendored read-only upstream tests where applicable.

## Out of Scope

- Automatic heartbeat or heartbeat timeout detection.
- General-purpose business-message sending outside subscribe and unsubscribe controls.
- Historical replay, event-log semantics, or guaranteed processing of every intermediate message.
- Configurable PubSub capacity or alternative dropping/backpressure strategies.
- Configurable reconnect schedules, retry limits, jitter, or exponential backoff.
- Durable subscription persistence across process restarts.
- Delivery acknowledgements, exactly-once delivery, idempotency keys, or server-side subscription confirmation.
- Dynamic mutation of the protocol catalog after Socket Client initialization.
- Processing messages that do not match an active subscription record.
- Modifying or importing from the vendored `repos/effect/` subtree.

## Further Notes

- The design deliberately treats local subscription state as desired state and the outbound queue as connection-epoch state. Reconnect rebuilds the latter from the former instead of replaying stale commands.
- Identity equality is exact string equality. Each subscription factory and its protocol matcher must agree on the identity representation.
- Protocol match functions are intentionally coarse. Schema remains the authority for validating and transforming inbound business data.
- The initial design favors a small, fixed behavior surface. Retry schedules, heartbeat behavior, general sending, and delivery guarantees can be added only when a concrete business requirement appears.
