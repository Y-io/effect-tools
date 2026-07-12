# Browser

为业务 runtime 提供由浏览器环境产生的共享信号与服务。

## Language

**浏览器服务（Browser Service）**：
由浏览器环境提供，并通过业务 runtime 供其他服务消费的能力。
_Avoid_: 公共服务、Common Service

**网络信号（Network Signal）**：
浏览器报告的当前网络在线状态；状态未改变时不发布，慢消费者只观察最新状态。它不是网络可达性保证或状态变化日志。
_Avoid_: 网络监视器、Network Monitor、网络事件流

**页面可见信号（Page Visibility Signal）**：
浏览器报告的当前文档是否对用户可见；状态未改变时不发布，慢消费者只观察最新状态。它不表示浏览器窗口是否获得输入焦点，也不是可见性变化日志。
_Avoid_: Tab 激活信号、Tab Active Signal、Window Focus Signal
