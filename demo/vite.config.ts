import { defineConfig } from "vite";
import path from "node:path";
export default defineConfig({
  root: path.resolve(__dirname),
  base: "/shift-scheduler/",
  publicDir: false,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../src"),
      "next/navigation": path.resolve(__dirname, "navigation.ts"),
    },
  },
  build: {
    rolldownOptions: {
      onwarn(warning, warn) {
        if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning);
      },
    },
    outDir: path.resolve(__dirname, "../out-demo"),
    emptyOutDir: true,
  },
});
