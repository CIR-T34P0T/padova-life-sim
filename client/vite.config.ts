import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The client is served by Vite in development. `host: true` exposes it on the
// local network so a phone on the same Wi-Fi can open it.
export default defineConfig({
  server: {
    host: true,
    port: Number(process.env.CLIENT_PORT ?? 5173),
    strictPort: true,
  },
  preview: {
    host: true,
    port: Number(process.env.CLIENT_PORT ?? 4173),
    strictPort: true,
  },
  build: {
    target: "es2022",
    sourcemap: true,
    rolldownOptions: {
      // The game, plus the character lab developer page (not linked from the game).
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        lab: fileURLToPath(new URL("lab.html", import.meta.url)),
      },
    },
  },
});
