import { test as setup } from "@playwright/test"
import { existsSync, statSync } from "node:fs"

const AUTH = "scripts/qa/.auth.json"
const LOGIN = process.env.MCSW_QA_LOGIN_URL   // create-local-login.mjs output with the host swapped

// The magic link is one-use. Consume it exactly once per run; a rerun inside
// the cookie's life reuses the saved state instead of burning a second link.
setup("sign in as owner", async ({ page, context }) => {
  const fresh = existsSync(AUTH) && Date.now() - statSync(AUTH).mtimeMs < 6 * 60 * 60 * 1000
  if (fresh && process.env.MCSW_QA_REUSE_AUTH === "1") return
  if (!LOGIN) throw new Error("set MCSW_QA_LOGIN_URL (or MCSW_QA_REUSE_AUTH=1 with a fresh .auth.json)")
  await page.goto(LOGIN)
  await page.waitForURL(/\/board|\/ops/)
  await context.storageState({ path: AUTH })
})
