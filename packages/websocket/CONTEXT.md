# WebSocket

为 WebSocket 业务提供协议描述与客户端组合边界。

## Language

**协议目录（Protocol Catalog）**：
初始化后不可变的一组业务消息协议定义。每项定义具有唯一标识，并描述该业务消息的有效形态。
_Avoid_: 注册器、Registry

**协议定义（Protocol Definition）**：
协议目录中的一个具名条目，描述一种入站业务消息及其建立接收关系所需的信息；其消息 Schema 由该协议下的全部订阅实例共享。
_Avoid_: 配置项、Handler

**粗匹配（Coarse Match）**：
订阅实例结合自身 `identity` 对原始 WebSocket 消息进行的初步归属判断；首个命中的订阅实例获得该消息，命中只表示应尝试其 Schema，不表示消息已经有效。
_Avoid_: 校验、解码

**共享消息流（Shared Message Stream）**：
一个协议定义所接收业务消息的无历史回放最新值广播视图；多个消费者可独立消费同时到达的相同消息，慢消费者只保留尚未消费的最新一条。
_Avoid_: 事件日志、无损队列、单消费者 Stream

**订阅实例（Subscription Instance）**：
由协议定义与 `identity` 共同标识的一条独立消息接收关系。同一订阅实例的消费者共享消息，彼此不同的订阅实例相互隔离，但共用所属协议定义的消息 Schema。
_Avoid_: 协议订阅、全局订阅

**订阅管理器（Subscription Manager）**：
维护全部订阅实例，并作为 WebSocket 订阅控制消息的唯一有序入口。连接中断时保留当前活跃订阅，连接恢复后据此重新建立远端订阅。
_Avoid_: 订阅队列、发送器

**Socket Client**：
由一个协议目录与一个 WebSocket 连接共同构成的完整 WebSocket 业务客户端。
_Avoid_: WebSocket Client、WS Client
