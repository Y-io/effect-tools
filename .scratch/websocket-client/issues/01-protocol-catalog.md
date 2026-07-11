# 建立不可变协议目录

Status: needs-info

## Parent

[Effect WebSocket Client PRD](../PRD.md)

## What to build

建立 Socket Client 的协议描述边界。业务可以在初始化时声明一组具名协议定义；每项定义包含 Effect Schema、`match(parsed, identity)` 和 subscription factory。协议目录初始化后不可变，并保留每个协议的业务参数与 Schema 输出类型，供后续组件生成类型安全 API。

本 issue 只负责静态协议定义，不维护活跃订阅实例、不接收 WebSocket frame，也不执行消息路由。

覆盖 PRD User Stories：1–2、5、8–10。

## Acceptance criteria

- [ ] 可以声明由唯一键索引的不可变协议目录。
- [ ] 每个协议定义必须提供 Effect Schema、`match(parsed, identity): boolean` 和 subscription factory。
- [ ] subscription factory 接收业务参数并返回字符串 identity，以及可选的 subscribe/unsubscribe 控制消息。
- [ ] 协议目录保留各协议 subscription factory 的精确参数元组类型。
- [ ] 协议目录保留各协议 Schema 的解码输出类型。
- [ ] 协议目录初始化后不能动态增加、删除或替换协议定义。
- [ ] 测试仅通过公开协议目录 API 验证行为与编译期类型，不断言内部表示。
- [ ] 类型检查、测试、lint 和格式检查通过。

## Blocked by

None - can start immediately

## Execution gate

等待用户明确确认后才能开始实现。
