import { defineConfig, type OxlintConfig } from "oxlint"

export default defineConfig({
  categories: {
    correctness: "error",
    suspicious: "warn",
    perf: "warn",
  },
  ignorePatterns: [
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".turbo",
    ".next",
    ".vite",
    "repos/**",
  ],
  plugins: [],
} as OxlintConfig)
