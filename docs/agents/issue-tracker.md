# Issue tracker: Local Markdown

本仓库的 issues 和 PRDs 使用本地 Markdown 文件管理，统一放在 `.scratch/` 目录下。

## Conventions

- 每个功能或工作流一个目录：`.scratch/<feature-slug>/`
- PRD 文件为：`.scratch/<feature-slug>/PRD.md`
- 实现 issue 文件为：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 开始编号
- Triage 状态写在每个 issue 文件顶部附近的 `Status:` 行中，状态值见 `triage-labels.md`
- 评论和对话历史追加到文件底部的 `## Comments` 标题下

## When a skill says "publish to the issue tracker"

在 `.scratch/<feature-slug>/` 下创建新文件；如果目录不存在，先创建目录。

## When a skill says "fetch the relevant ticket"

读取用户引用的本地 issue 文件。用户通常会直接给出文件路径或 issue 编号。

## Wayfinding operations

`/wayfinder` 使用一张 map 文件和多个 child ticket 文件来推进大型工作。

- **Map**：`.scratch/<effort>/map.md`，记录 Notes、Decisions-so-far 和 Fog
- **Child ticket**：`.scratch/<effort>/issues/NN-<slug>.md`，从 `01` 开始编号，正文写清问题；顶部用 `Type:` 记录类型（`research`、`prototype`、`grilling` 或 `task`），用 `Status:` 记录 `claimed` 或 `resolved`
- **Blocking**：顶部附近的 `Blocked by: NN, NN` 行表示依赖。列出的 ticket 全部 `resolved` 后，该 ticket 才算解除阻塞
- **Frontier**：扫描 `.scratch/<effort>/issues/`，找出未完成、未阻塞、未 claimed 的 ticket；编号最小者优先
- **Claim**：开始工作前，把 `Status:` 设置为 `claimed` 并保存
- **Resolve**：在 `## Answer` 标题下追加答案，把 `Status:` 设置为 `resolved`，然后在 `map.md` 的 Decisions-so-far 中追加一个上下文指针（摘要 + 链接）
