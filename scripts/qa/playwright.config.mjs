import { defineConfig } from "@playwright/test"

if (!process.env.MCSW_QA_BASE) throw new Error("set MCSW_QA_BASE")

const automationBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
if (process.env.MCSW_QA_STRICT === "1" && !automationBypass) {
  throw new Error("VERCEL_AUTOMATION_BYPASS_SECRET is required for strict preview QA")
}

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.MCSW_QA_BASE,
    colorScheme: "dark",
    ...(automationBypass
      ? { extraHTTPHeaders: { "x-vercel-protection-bypass": automationBypass } }
      : {}),
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.mjs/ },
    { name: "gate", testMatch: /final-polish\.spec\.mjs/, dependencies: ["setup"],
      use: { storageState: "scripts/qa/.auth.json" } },
  ],
})
