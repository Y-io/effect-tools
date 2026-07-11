# 建立 WebSocket 连接边界

Status: needs-info

## Parent

[Effect WebSocket Client PRD](../PRD.md)

## What to build

建立单次 WebSocket connection epoch 的底层资源边界，使生产连接与测试 fake connection 使用同一公开接口。连接向上层暴露 raw frame、发送控制消息、连接关闭与失败信号，并由 Effect Scope 确定性释放。

该边界只表达一条连接的输入、输出与终止，不解析业务 frame、不保存订阅状态，也不负责重连策略。

支撑 PRD User Stories：3、21、23、28、32–33 的底层连接能力。

## Acceptance criteria

- [x] 公开连接接口允许消费 raw WebSocket frame。
- [x] 公开连接接口允许按调用顺序发送订阅控制消息，并报告发送失败。
- [x] 连接可以报告远端断开、本地关闭及底层失败。
- [x] Effect Scope 结束会确定性关闭当前连接并释放接收与发送资源。
- [x] 可以通过同一公开接口提供可控 fake connection，支持发出 frame、断线和发送失败。
- [x] 连接边界不包含 parser、Schema、订阅实例、引用计数或重连策略。
- [x] 测试通过公开连接接口验证收发、失败与 Scope 清理，不依赖真实网络。
- [x] 类型检查、测试、lint 和格式检查通过。

## Blocked by

None - can start immediately

## Execution gate

等待用户明确确认后才能开始实现。
