# effect-stack

基于 Bun 和 Effect v3 的工具集合 monorepo。

## 安装依赖

```bash
bun install
```

## 代码质量

```bash
bun run lint
bun run format:check
```

自动修复：

```bash
bun run lint:fix
bun run format
```

Lint 和 format 的项目配置都在 `oxlint.config.ts` 与 `oxfmt.config.ts` 中维护；Oxc 会自动发现最近的配置文件，`package.json` scripts 只保留命令和执行模式。

## 目录约定

- `packages/*`：Effect v3 工具封装包
- `docs/agents/*`：agent 技能配置
- `.scratch/*`：本地 Markdown issue / PRD
