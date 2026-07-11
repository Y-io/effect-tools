# 增加引用计数与有序订阅控制

Status: ready-for-agent

## Parent

[Effect WebSocket Client PRD](../PRD.md)

## What to build

在最新值 Stream 闭环上增加主动订阅生命周期。订阅工厂可为同一个 identity 生成可选的 subscribe 与 unsubscribe 控制消息；订阅管理器按协议与 identity 复用订阅实例，通过 Effect Scope 管理消费者引用计数，并作为控制消息的唯一 writer 维护 FIFO 发送顺序。

本地订阅实例及消费者广播必须在 subscribe 发送前建立。相同订阅实例的并发消费者只能产生一次远端订阅；最后一个消费者退出后才发送一次取消订阅。无控制消息的被动订阅继续使用相同 API。

覆盖 PRD User Stories：8–10、17–24。

## Acceptance criteria

- [ ] 订阅工厂可一次生成字符串 identity 与可选 subscribe/unsubscribe 控制消息，两条控制消息天然绑定同一订阅实例。
- [ ] 同一协议与 identity 的首个消费者使引用计数从零变为一，并只发送一次 subscribe；后续消费者只复用本地订阅实例。
- [ ] 消费者正常结束、失败或被中断时由 Scope 自动释放引用；只有最后一个消费者退出才发送一次 unsubscribe。
- [ ] 本地订阅实例和当前消费者的广播接入先于 subscribe 发送完成，服务端立即响应时首条消息可被观察到。
- [ ] 所有订阅实例增删、引用计数变更及 subscribe/unsubscribe 发送按生命周期顺序串行化。
- [ ] 订阅管理器是控制消息的唯一 writer，并通过单一 FIFO 队列发送；第一版不暴露通用业务 send 或心跳功能。
- [ ] 并发 acquire/release 的行为测试证明不会产生重复控制消息、负引用计数或提前取消订阅。
- [ ] 被动订阅配置不生成控制消息，但仍保持与主动订阅相同的 Stream、identity 和 Scope 语义。
- [ ] 类型检查、测试、lint 和格式检查通过。

## Blocked by

- [01 打通被动订阅的最新值 Stream](./01-passive-latest-value-stream.md)
