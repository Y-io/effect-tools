import { defineConfig } from "oxfmt"

export default defineConfig({
  printWidth: 100,
  semi: false,
  ignorePatterns: [
    "node_modules/**",
    "dist/**",
    "out/**",
    "coverage/**",
    ".scratch/**",
    ".idea/**",
    "docs/**",
    "**/*.md",
    "**/*.lock",
    ".gitignore",
    "bun.lock",
    "packages/.gitkeep",
  ],
})
