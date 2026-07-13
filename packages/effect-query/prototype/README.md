# PROTOTYPE — Effect Query options 与 hook

这个集成 fixture 验证：`effectQueryOptions` 能否保持 JSON object input 与 Effect 的成功、失败和环境类型，同时让 `useEffectQuery` 只在执行边界读取共享 runtime 并转换为 TanStack Query options。

验证 React runtime factory 与 TanStack Start SSR：

```sh
bun run prototype:effect-query:verify
```

原型结论已经吸收到 `../src` 的正式实现。这里保留 TanStack Start fixture 与设计记录，用于回归 SSR/hydration 集成。
