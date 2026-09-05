import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// The interface is emitted into the Python package, so the platform ships as
// one process and one container rather than a server plus a static host.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    outDir: "../src/blackboardxray/server/web",
    emptyOutDir: true,
  },
  server: {
    proxy: { "/api": "http://127.0.0.1:8900" },
  },
});
