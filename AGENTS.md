# Agent 指令

项目沟通、项目文档和面向维护者的说明尽量使用中文；代码标识符、协议字段、命令、错误信息和第三方 API 名称按其原始语言保留。

## 运行时和包管理器

使用 Bun 作为运行时、包管理器和脚本执行器。

## 外部源码参考

`repos/effect/` 通过 Git subtree 引入 `Effect-TS/effect` 的 Effect v3 源码，版本必须与项目实际安装的 `effect` 版本保持一致。

- 编写或审查 Effect 代码时，优先检查 `repos/effect/packages/effect/src/` 中的实现和 `repos/effect/packages/effect/test/` 中的测试，再按需查阅相关包的 README。
- 将 `repos/effect/` 视为只读参考资料；除非任务明确要求，否则不要修改其中的文件。
- 不要从 `repos/effect/` 导入任何模块；项目代码必须继续使用 `package.json` 中声明的依赖。
- 更新 `effect` 依赖时，同步更新此 subtree 到相同版本的 `effect@<version>` tag。

同步上游源码时使用：

```sh
git subtree pull --prefix=repos/effect https://github.com/Effect-TS/effect.git effect@3.21.4 --squash
```

## Agent 技能

### Issue tracker

Issues 和 PRDs 使用 `.scratch/` 下的本地 Markdown 文件管理；外部 PR 不作为 triage 入口。详见 `docs/agents/issue-tracker.md`。

### Triage 标签

本仓库使用默认的五角色 triage 词汇：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human` 和 `wontfix`。详见 `docs/agents/triage-labels.md`。

### 领域文档

本仓库是面向 Effect v3 工具封装的 multi-context monorepo：根目录的 `CONTEXT-MAP.md` 指向各 context 自己的 `CONTEXT.md`。详见 `docs/agents/domain.md`。
