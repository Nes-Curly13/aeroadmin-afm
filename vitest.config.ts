import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname)
    }
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    css: false,
    // Componentes de Next/Image y Map (Leaflet) usan APIs de browser que
    // no necesitamos ejercitar en tests unitarios.
    server: {
      deps: {
        inline: ["@testing-library/react"]
      }
    }
  }
});
