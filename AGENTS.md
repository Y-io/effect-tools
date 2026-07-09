# Agent Instructions

项目沟通、项目文档和面向维护者的说明尽量使用中文；代码标识符、协议字段、命令、错误信息和第三方 API 名称按其原始语言保留。

## Agent skills

### Issue tracker

Issues and PRDs are tracked as local Markdown files under `.scratch/`; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

The repo uses the default five-role triage vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This is a multi-context monorepo for Effect v3-based tool wrappers: `CONTEXT-MAP.md` at the repo root points to context-specific `CONTEXT.md` files. See `docs/agents/domain.md`.
