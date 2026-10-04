import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// FLOWCOMMIT_PORT and FLOWCOMMIT_WEB_PORT let two projects run side by side.
const serverPort = Number(process.env.FLOWCOMMIT_PORT ?? 4318);
const webPort = Number(process.env.FLOWCOMMIT_WEB_PORT ?? 5317);

export default defineConfig({
  plugins: [react()],
  server: {
    port: webPort,
    // Fail instead of quietly moving to another port, so it's clear which FlowCommit you're talking to.
    strictPort: true,
    proxy: { "/api": `http://127.0.0.1:${serverPort}` },
  },
});
