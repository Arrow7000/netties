/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { fakeModel } from "./scripts/fakeModel";

export default defineConfig({
  plugins: [solid(), fakeModel()],
  test: {
    // The core is plain TypeScript; UI tests can opt into jsdom per file.
    environment: "node",
  },
});
