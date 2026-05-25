import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig(() => {
  // Allow API port override (used by e2e tests pointing to an isolated backend)
  const apiPort = process.env.VITE_API_PORT ?? "3100";
  const apiTarget = `http://localhost:${apiPort}`;

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": resolve(__dirname, "./src"),
      },
    },
    server: {
      port: 3200,
      proxy: {
        "/api": apiTarget,
        "/ws": {
          target: apiTarget.replace("http", "ws"),
          ws: true,
        },
      },
    },
  };
});
