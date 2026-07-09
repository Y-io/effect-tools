import { defineConfig } from "oxlint"

export default defineConfig({
  ignorePatterns: ["node_modules/**", "dist/**", "out/**", "coverage/**", ".scratch/**"],
  options: {
    denyWarnings: true,
  },
  plugins: ["typescript", "unicorn", "oxc", "import"],
  categories: {
    correctness: "error",
    suspicious: "error",
    perf: "warn",
  },
  rules: {
    "no-console": "off",
  },
})
