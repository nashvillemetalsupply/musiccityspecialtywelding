import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

// Final polish pass after the ops→board conversion: the owner Morning Brief
// must never leak the crew-redaction marker, the satellite board pages must
// honor the saved theme on a hard load, and the legacy /ops?view=updates
// notification URLs must be backfilled. Each is invisible at runtime until the
// wrong slip is tapped or a page is hard-reloaded, so the contracts are pinned
// here.

const root = new URL("..", import.meta.url)
const source = (path) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n")

const BRIEF = source("app/api/ops/brief/route.ts")
const BOOT = source("app/board/theme-boot.tsx")
const SATELLITES = ["app/board/customers/page.tsx", "app/board/calls/page.tsx", "app/board/updates/page.tsx"]
const MIGRATE = source("scripts/migrate.mjs")

test("the owner Morning Brief prompt is fed the unredacted summary, not crew_summary", () => {
  // The prompt still stringifies `facts` into the owner-facing body.
  assert.match(BRIEF, /prompt: JSON\.stringify\(facts\)/)
  // facts.promises is rebuilt from the unredacted `summary`, dropping the
  // pre-redacted `crew_summary` column before it reaches the prompt.
  assert.match(BRIEF, /const ownerPromiseFacts = promises\.map\(/)
  assert.match(BRIEF, /const facts = \{ promises: ownerPromiseFacts, unanswered/)
  const factsBlock = BRIEF.slice(BRIEF.indexOf("const ownerPromiseFacts"), BRIEF.indexOf("const facts ="))
  assert.match(factsBlock, /summary: item\.summary/)
  assert.doesNotMatch(factsBlock, /crew_summary/)
  // The crew promise sheet still reads crew_summary directly — that is the
  // crew arm, not the owner body, and it stays untouched.
  assert.match(BRIEF, /const crewPromiseSheet/)
})

test("the satellite board pages render the shared pre-paint theme boot", () => {
  assert.match(BOOT, /mcsw-theme/)
  assert.match(BOOT, /data-theme/)
  assert.match(BOOT, /dangerouslySetInnerHTML/)
  assert.match(BOOT, /try\s*\{/)
  for (const path of SATELLITES) {
    const page = source(path)
    assert.match(page, /import \{ ThemeBoot \} from "\.\.\/theme-boot"/, `${path} imports the shared boot`)
    assert.match(page, /<ThemeBoot \/>/, `${path} renders the shared boot`)
  }
})

test("migrate.mjs backfills the legacy /ops?view=updates notification URLs", () => {
  // The idempotent WHERE gate touches only rows with the stale prefix.
  assert.match(MIGRATE, /url LIKE '\/ops\?view=updates%'/)
  // The stale prefix is rewritten to /board/updates, and a trailing query
  // string is reattached after the path instead of being lost.
  assert.ok(MIGRATE.includes('.replace(/^\\/ops\\?view=updates/, "/board/updates")'), "stale prefix is rewritten to /board/updates")
  assert.ok(MIGRATE.includes('.replace(/^\\/board\\/updates&/, "/board/updates?")'), "a trailing query string is reattached after the path")
  // The write-back carries explicit Postgres casts.
  assert.match(MIGRATE, /UPDATE notifications SET url = \$\{next\}::text WHERE id = \$\{row\.id\}::bigint/)
})

test("crew event projections strip the generated owner-body tsvector columns", () => {
  // No test imports .ts under node --test (visibility.ts resolves through the
  // @/ alias), so the contract is pinned as a source assertion: the owner
  // early-return hands the raw row through untouched, and every crew branch
  // spreads the tsv-stripped `safe` row, never the raw event.
  const visibility = source("lib/visibility.ts")
  const projection = visibility.slice(visibility.indexOf("export function projectEventForRole"))
  assert.match(projection, /if \(role === "owner"\) return event/)
  assert.match(projection, /delete safe\.tsv\n\s*delete safe\.crew_tsv/)
  assert.ok((projection.match(/\.\.\.safe/g) ?? []).length >= 6, "every crew branch spreads the stripped row")
  assert.doesNotMatch(projection, /return \{\s*\.\.\.event\b/, "no crew branch returns a spread of the raw event row")
})

test("the latest-brief route responds with an allowlisted brief DTO, not the raw projection", () => {
  const latest = source("app/api/ops/brief/latest/route.ts")
  assert.match(latest, /brief: brief \? \{ id: brief\.id, kind: brief\.kind, body: brief\.body, occurred_at: brief\.occurred_at \} : null/)
  assert.doesNotMatch(latest, /Response\.json\(\{ brief, audioUrl/)
  // The DTO carries only id/kind/body/occurred_at — no detail, no tsvector columns.
  const dto = latest.slice(latest.indexOf("brief: brief ? {"), latest.indexOf("} : null,"))
  assert.doesNotMatch(dto, /detail|tsv|crew_tsv/)
})
