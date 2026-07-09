# Domain Docs

本仓库是一个 monorepo，用于沉淀基于 Effect v3 封装的工具集合。工程技能在探索代码前，应按本文件约定读取领域文档。

## Before exploring, read these

- 根目录的 **`CONTEXT-MAP.md`**，如果存在，它会指向各个 context 的 `CONTEXT.md`；只读取和当前任务相关的 context
- 根目录的 **`CONTEXT.md`**，如果项目后来切回 single-context 布局
- 根目录的 **`docs/adr/`**，读取和当前工作区域相关的 ADR
- multi-context 布局下，也检查各 context 自己的 `docs/adr/`，例如 `packages/<context>/docs/adr/`、`apps/<context>/docs/adr/` 或实际目录结构中等价的位置

如果这些文件暂时不存在，继续工作，不要因为缺失而中断，也不要预先要求创建。`/domain-modeling` 技能会在术语或决策真正需要沉淀时按需创建。

## File structure

本仓库默认采用 multi-context 布局：

```text
/
├── CONTEXT-MAP.md
├── docs/adr/                         # 跨 context 的系统级决策
├── packages/
│   └── <context>/
│       ├── CONTEXT.md
│       └── docs/adr/                 # context 内部决策
└── apps/
    └── <context>/
        ├── CONTEXT.md
        └── docs/adr/
```

如果未来项目收敛为 single-context，则可改为：

```text
/
├── CONTEXT.md
├── docs/adr/
└── src/
```

## Use the glossary's vocabulary

当输出中命名领域概念时，例如 issue 标题、重构建议、bug 假设或测试名，应优先使用 `CONTEXT.md` 中定义的术语。不要随意替换成词义相近但项目没有采用的说法。

如果需要的概念还没有进入 glossary，说明这里存在一个建模信号：要么当前表达不是项目语言，要么确实有新概念需要通过 `/domain-modeling` 补充。

## Flag ADR conflicts

如果你的输出和已有 ADR 冲突，必须明确指出冲突，而不是静默覆盖：

> Contradicts ADR-0007 (event-sourced orders) - but worth reopening because...
