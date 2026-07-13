import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import react from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [tanstackStart(), react()],
  root: fileURLToPath(new URL(".", import.meta.url)),
})
