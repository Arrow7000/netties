/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import solid from "vite-plugin-solid";
import { chatDev } from "./netlify/lib/chatDev";

export default defineConfig(({ mode }) => ({
  plugins: [solid(), chatDev(loadEnv(mode, process.cwd(), ""))],
  test: {
    // The core is plain TypeScript; UI tests can opt into jsdom per file.
    environment: "node",
  },
}));
