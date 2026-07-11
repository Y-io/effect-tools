# 增加断线恢复与无限重连

Status: ready-for-agent

## Parent

[Effect WebSocket Client PRD](../PRD.md)

## What to build

使 Socket Client 在连接中断和订阅控制消息发送失败后恢复当前期望订阅状态。断线立即废弃当前连接 epoch 的控制消息队列，但订阅管理器保留引用计数大于零的本地订阅实例；新连接建立后，从这些当前记录重新生成 subscribe 消息，而不是回放旧队列。

Socket Client Scope 存活期间固定每三秒无限重连。控制消息发送失败立即关闭当前连接并进入同一重连流程；Scope 结束时停止重连并释放连接、队列、订阅记录和广播资源。

覆盖 PRD User Stories：28–33。

## Acceptance criteria

- [ ] WebSocket 断开后清空尚未发送的控制消息队列，同时保留引用计数大于零的本地订阅实例。
- [ ] 断线期间发生的 acquire/release 只改变当前本地期望状态，不积压供新连接回放的旧控制命令。
- [ ] 新连接建立后，按活跃订阅实例的稳定顺序重新生成并发送 subscribe，仅恢复当时引用计数大于零的实例。
- [ ] subscribe 或 unsubscribe 的底层 send 失败立即使当前连接失效、清空当前队列并进入重连流程。
- [ ] Socket Client Scope 存活期间每三秒尝试重连且没有重试次数上限。
- [ ] 现有 Stream 跨临时断线保持存活，并在重新订阅后继续接收最新消息。
- [ ] Scope 结束会停止未来重连、关闭当前连接并清理队列、订阅记录和广播资源。
- [ ] 使用假连接与 Effect TestClock 验证三秒重连间隔、旧队列不回放、活跃订阅恢复及发送失败路径。
- [ ] 类型检查、测试、lint 和格式检查通过。

## Blocked by

- [02 增加引用计数与有序订阅控制](./02-reference-counted-subscription-control.md)
