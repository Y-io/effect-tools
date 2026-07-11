# 打通被动订阅的最新值 Stream

Status: ready-for-agent

## Parent

[Effect WebSocket Client PRD](../PRD.md)

## What to build

实现第一个可运行的 Socket Client 纵向闭环：业务以不可变协议目录声明订阅工厂、`match(parsed, identity)` 与 Schema，通过显式 frame parser 接收底层 WebSocket 数据，并以 `client.<protocol>.stream(...args)` 取得按 identity 隔离的 Schema 解码结果。

本切片使用不产生 subscribe/unsubscribe 控制消息的被动订阅配置。每个订阅实例提供无历史回放的最新值广播；多个活跃消费者同时收到相同消息，慢消费者只保留尚未消费的最新一条。解析失败、无订阅实例命中及 Schema 解码失败均只丢弃当前消息。

覆盖 PRD User Stories：1–7、10–16、25–27。

## Acceptance criteria

- [ ] 可以声明包含必需订阅工厂、`match(parsed, identity): boolean` 和 Schema 的不可变协议目录，并从目录推导类型安全的 `client.<protocol>.stream(...args)` API。
- [ ] Socket Client 使用调用方显式提供的同步 parser 解析原始 frame；parser 抛错只丢弃当前 frame。
- [ ] `stream(...args)` 通过订阅工厂生成内部字符串 identity，消费者只获得 Schema 解码后的消息。
- [ ] 入站消息按订阅实例的稳定创建顺序执行 `match(parsed, identity)`，首个命中的实例使用其协议 Schema 解码完整 parsed 值并接收结果。
- [ ] 不匹配任何活跃订阅或 Schema 解码失败的消息不会终止连接或 Stream。
- [ ] 同一协议与 identity 的多个活跃消费者收到相同的实时消息，不同 identity 的消费者相互隔离。
- [ ] 广播具有 `PubSub.sliding(1)` 且无 replay 的外部语义：慢消费者只保留最新待消费消息，新消费者不收到加入前的值。
- [ ] 测试通过公共 Socket Client API、可控假 WebSocket 连接及真实 Effect Scope 验证完整闭环，不直接断言内部容器结构。
- [ ] 新 package 使用 Bun 脚本通过类型检查、测试、lint 和格式检查。

## Blocked by

None - can start immediately
