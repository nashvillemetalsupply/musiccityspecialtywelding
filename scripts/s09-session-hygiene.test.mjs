import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("sessions fail closed and slide a 14-day idle expiry", () => {
  const auth = source("lib/ops-auth.ts")
  const validation = source("lib/ops-session-validation.ts")
  const migration = source("scripts/migrate.mjs")

  assert.match(auth, /SESSION_IDLE_TTL_MS = 14 \* 24 \* 60 \* 60 \* 1000/)
  assert.match(auth, /validateSessionTokenWithSql\(/)
  assert.match(validation, /SELECT o\.\*, \(t\.last_used_at < now\(\) - interval '1 hour'\) AS refresh_due/)
  assert.match(validation, /UPDATE ops_tokens t SET[\s\S]*last_used_at = now\(\)/)
  assert.match(validation, /expires_at = now\(\) \+ interval '14 days'/)
  assert.match(validation, /last_used_at > now\(\) - interval '14 days'/)
  assert.match(validation, /catch \{\s+return null\s+\}/)
  assert.match(migration, /ALTER TABLE ops_tokens ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/)
})

test("the Shop card revokes the current session and the logout route uses revokeSession", () => {
  const auth = source("lib/ops-auth.ts")
  const logout = source("app/api/ops/logout/route.ts")
  const shop = source("app/ops/shop/page.tsx")

  assert.match(auth, /export async function revokeSession\(token: string \| undefined\)/)
  assert.match(logout, /import \{ revokeSession, OPS_SESSION_COOKIE \} from "@\/lib\/ops-auth"/)
  assert.match(logout, /await revokeSession\(token\)/)
  assert.match(shop, /action="\/api\/ops\/logout" method="post"[^>]*>\s*<button[^>]*>Revoke this session<\/button>/)
})

test("the owner quote email does not include the customer's IP address", () => {
  const quote = source("app/api/quote/route.ts")
  const textStart = quote.indexOf("const text = [")
  const textEnd = quote.indexOf("].join(\"\\n\")", textStart)
  assert.ok(textStart >= 0 && textEnd > textStart)
  assert.doesNotMatch(quote.slice(textStart, textEnd), /IP:\s*\$\{ip\}/)
})
