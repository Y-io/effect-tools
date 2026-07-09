import { defineConfig } from "oxfmt"

export default defineConfig({
  printWidth: 100,
  semi: false,
  singleQuote: false,
  trailingComma: "all",
  sortImports: true,
  ignorePatterns: [
    "node_modules/**",
    "dist/**",
    "out/**",
    "coverage/**",
    ".scratch/**",
    ".idea/**",
    "docs/**",
    "**/*.md",
    "**/*.json",
    "**/*.jsonc",
    "**/*.lock",
    ".gitignore",
    "bun.lock",
    "packages/.gitkeep",
  ],
})
