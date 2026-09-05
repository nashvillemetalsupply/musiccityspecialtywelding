import { defineConfig } from "@playwright/test"

if (!process.env.MCSW_QA_BASE) throw new Error("set MCSW_QA_BASE")

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.MCSW_QA_BASE, colorScheme: "dark" },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.mjs/ },
    { name: "gate", testMatch: /final-polish\.spec\.mjs/, dependencies: ["setup"],
      use: { storageState: "scripts/qa/.auth.json" } },
  ],
})
