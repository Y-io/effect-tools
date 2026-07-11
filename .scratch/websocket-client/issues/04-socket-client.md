# 组装 Socket Client

Status: needs-info

## Parent

[Effect WebSocket Client PRD](../PRD.md)

## What to build

组合协议目录、订阅管理器与 WebSocket 连接，提供完整的业务 Socket Client。业务通过 `client.<protocol>.stream(...args)` 建立订阅；客户端使用调用方显式提供的同步 parser 解析 raw frame，按订阅实例稳定顺序执行粗匹配，并由首个命中实例所属协议的 Schema 解码完整消息。

客户端隔离 parser、未匹配消息与 Schema decode 失败，并负责 connection epoch 切换、固定三秒无限重连、控制消息发送失败后的连接失效，以及从当前活跃订阅状态恢复远端订阅。

覆盖 PRD User Stories：3–7、11–12、25–33，并集成验收其余 stories。

## Acceptance criteria

- [ ] 协议目录生成类型安全的 `client.<protocol>.stream(...args)`，参数来自 subscription factory，元素类型来自协议 Schema。
- [ ] 客户端使用显式同步 parser；parser 抛错只丢弃当前 frame，并支持直接传入 `JSON.parse`。
- [ ] 入站消息按订阅实例稳定创建顺序执行 `match(parsed, identity)`，首个匹配实例获胜。
- [ ] Schema 解码完整 parsed 值；decode 失败、无匹配消息与 parser 失败均不终止连接或现有 Stream。
- [ ] 本地订阅实例和消费者接入先于 subscribe 发送，使立即响应对首个消费者可见。
- [ ] WebSocket 断开会清除当前 connection epoch 的 sender，但保留当前活跃期望订阅；后续事件继续更新本地列表而不发送控制消息。
- [ ] 新连接只从当时仍活跃的订阅实例重建 subscribe，不回放旧控制命令。
- [ ] 控制消息发送失败立即使连接失效，并进入与断线相同的重连路径。
- [ ] Socket Client Scope 存活期间每三秒无限重连；Scope 结束停止重连并释放全部组合资源。
- [ ] 测试通过完整 Socket Client、可控 fake connection、真实 Effect Scope 与 Effect TestClock 验证端到端行为。
- [ ] 类型检查、测试、lint 和格式检查通过。

## Blocked by

- [01 建立不可变协议目录](./01-protocol-catalog.md)
- [02 实现订阅管理器](./02-subscription-manager.md)
- [03 建立 WebSocket 连接边界](./03-websocket-connection.md)

## Execution gate

等待用户明确确认后才能开始实现。
