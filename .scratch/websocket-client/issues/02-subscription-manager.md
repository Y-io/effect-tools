# 实现订阅管理器

Status: needs-info

## Parent

[Effect WebSocket Client PRD](../PRD.md)

## What to build

实现订阅实例的统一生命周期边界。订阅管理器按协议键与 identity 唯一标识订阅实例，保持稳定创建顺序，并为每个实例提供无历史回放的最新值共享消息流。相同实例的多个消费者共享广播和远端订阅，不同实例相互隔离。

订阅管理器通过 Effect Scope 管理消费者引用，串行化 acquire/release，并作为 subscribe/unsubscribe 控制消息的唯一有序入口。它维护期望订阅状态，但不负责建立 WebSocket 连接、解析 raw frame 或执行 Schema 解码。

覆盖 PRD User Stories：13–24。

## Acceptance criteria

- [x] 协议键与字符串 identity 的组合唯一标识订阅实例。
- [x] 订阅实例保持稳定创建顺序，可供上层执行确定性的首匹配路由。
- [x] 同一订阅实例的多个活跃消费者接收相同实时消息，不同实例相互隔离。
- [x] 共享消息流具有 `PubSub.sliding(1)` 且无 replay 的外部语义。
- [x] 首个消费者建立实例并产生至多一次可选 subscribe；后续消费者只增加引用。
- [x] 消费者正常结束、失败或中断时由 Scope 自动释放引用；最后一个消费者退出时产生至多一次可选 unsubscribe。
- [x] acquire/release 与控制消息顺序串行化，订阅管理器是控制消息的唯一 writer。
- [x] 无控制消息的被动订阅仍具有相同 identity、广播与 Scope 语义。
- [x] 测试通过订阅管理器公开 API 与真实 Effect Scope 验证，不断言内部 Map、引用字段、PubSub 或 queue。
- [ ] 类型检查、测试、lint 和格式检查通过。

## Blocked by

- [01 建立不可变协议目录](./01-protocol-catalog.md)

## Execution gate

等待用户明确确认后才能开始实现。
