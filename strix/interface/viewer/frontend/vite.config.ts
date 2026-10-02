import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// The viewer is served as static files by a stdlib Python server on an
// arbitrary ephemeral port, so all asset URLs must be relative (base: "./").
// The build output is committed at strix/interface/viewer/static and shipped.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "../static",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("@xyflow") || id.includes("@dagrejs") || id.includes("dagre")) {
              return "vendor-flow";
            }
            if (id.includes("highlight.js")) {
              return "vendor-highlight";
            }
            if (id.includes("lucide-react") || id.includes("react-icons")) {
              return "vendor-icons";
            }
            // Match specifically react and react-dom packages, not packages containing 'react-'
            const normalized = id.replace(/\\/g, "/");
            if (
              normalized.includes("/node_modules/react/") ||
              normalized.includes("/node_modules/react-dom/") ||
              normalized.includes("/node_modules/scheduler/")
            ) {
              return "vendor-react";
            }
            return "vendor";
          }
        },
      },
    },
  },
});
