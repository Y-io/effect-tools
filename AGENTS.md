# Agent 指令

项目沟通、项目文档和面向维护者的说明尽量使用中文；代码标识符、协议字段、命令、错误信息和第三方 API 名称按其原始语言保留。

## 运行时和包管理器

使用 Bun 作为运行时、包管理器和脚本执行器。

## Agent 技能

### Issue tracker

Issues 和 PRDs 使用 `.scratch/` 下的本地 Markdown 文件管理；外部 PR 不作为 triage 入口。详见 `docs/agents/issue-tracker.md`。

### Triage 标签

本仓库使用默认的五角色 triage 词汇：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human` 和 `wontfix`。详见 `docs/agents/triage-labels.md`。

### 领域文档

本仓库是面向 Effect v3 工具封装的 multi-context monorepo：根目录的 `CONTEXT-MAP.md` 指向各 context 自己的 `CONTEXT.md`。详见 `docs/agents/domain.md`。
