import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n")

const PAGE = read("../app/board/customers/page.tsx")
const CSS = read("../app/board/customers/customers.css")
const CONTROL = read("../styles/control.css")

// The regulars index was lost when /ops became the sign-in door. It comes back
// as a board route, and the two things that make it the same list are the data
// function it calls and the query params a bookmark carries.
test("the route reads the existing regulars query, not a new one", () => {
  assert.match(PAGE, /import \{ listRegularAccounts \} from "@\/lib\/wall-data"/)
  assert.match(PAGE, /import \{ normalizePage \} from "@\/lib\/pagination"/)
  assert.match(PAGE, /listRegularAccounts\(\{ page: normalizePage\(params\.accountPage\)/)
})

test("the query params stay accountQ and accountPage", () => {
  assert.match(PAGE, /accountQ\?: string/)
  assert.match(PAGE, /accountPage\?: string/)
  assert.match(PAGE, /name="accountQ"/)
  assert.match(PAGE, /params\.set\("accountPage"/)
  assert.match(PAGE, /params\.set\("accountQ"/)
})

// Real customer names behind the same door the rest of /ops sits behind. A
// missing database is a message; a missing operator is the sign-in door.
test("signed out lands on the /ops door and an unconfigured database says so", () => {
  assert.match(PAGE, /if \(!dbConfigured\(\)\)/)
  assert.match(PAGE, /const operator = await getAuthenticatedOperator\(\)/)
  assert.match(PAGE, /if \(!operator\) redirect\("\/ops"\)/)
  // Neither role is filtered out: the resolved role only configures the
  // shared navigation after authentication has succeeded.
  assert.match(PAGE, /<BoardRouteNav role=\{operator\.role\} current="customers" \/>/)
  assert.ok(PAGE.indexOf('if (!operator) redirect("/ops")') < PAGE.indexOf("<BoardRouteNav"))
})

test("rows link to the account page and keep the label and the counts", () => {
  assert.match(PAGE, /href=\{`\/ops\/accounts\/\$\{account\.person_id\}`\}/)
  assert.match(PAGE, /\{account\.label\}/)
  assert.match(PAGE, /account\.live_count \? `\$\{account\.live_count\} active` : `\$\{account\.job_count\} jobs`/)
})

// The old view is gone and stays gone: no legacy stylesheet, no dashboard
// markup, no archived module dragged back in behind this route.
test("nothing legacy comes back with it", () => {
  for (const dead of ["jobs.css", "jobs-brand.css", "ops-more-view", "ops-regulars-view", "archive"]) {
    assert.ok(!PAGE.includes(dead), `${dead} must not return with the customers route`)
    assert.ok(!CSS.includes(dead), `${dead} must not return with the customers stylesheet`)
  }
  assert.ok(!PAGE.includes("view=regulars"), "the route no longer hangs off an /ops view param")
})

test("the stylesheet is control tokens only — it names no raw colour", () => {
  assert.match(CSS, /@import\s+"\.\.\/\.\.\/\.\.\/styles\/control\.css"/)
  assert.doesNotMatch(CSS, /#[0-9a-fA-F]{3,8}\b/)
  // Every control component the page reaches for must actually exist.
  for (const component of [".find", ".btn", ".btn--go", ".btn--edge", ".chip", ".t-label", ".t-title", ".t-data"]) {
    assert.ok(CONTROL.includes(`${component}{`) || CONTROL.includes(`${component} `) || CONTROL.includes(`${component},`),
      `${component} is used by the customers route but is not defined in control.css`)
    assert.ok(PAGE.includes(component.slice(1)), `${component} is asserted but the page does not use it`)
  }
})

test("the board rail now points its Customers entry here", () => {
  // This assertion used to pin the opposite — the route shipped before its
  // navigation. The navigation task landed: the rail entry is this page.
  const board = read("../app/board/board.tsx")
  assert.match(board, /href="\/board\/customers" aria-label="Customers"/)
  assert.ok(!board.includes("view=regulars"), "the retired /ops regulars view must not come back")
})

// Page one is the floor. A hand-typed ?accountPage=0 or =-4 must not walk the
// OFFSET backwards. normalizePage owns that floor and listRegularAccounts owns
// the ceiling, so the route must hand the raw param to normalizePage and then
// render whatever page the query actually settled on.
test("the raw page param is floored by normalizePage and the rendered page is the query's", () => {
  const PAGINATION = read("../lib/pagination.ts")
  assert.match(PAGINATION, /export function normalizePage/)
  assert.match(PAGINATION, /Math\.max\(1, Math\.floor\(numeric\)\)/)
  assert.match(PAGE, /normalizePage\(params\.accountPage\)/)
  assert.ok(!/Number\(params\.accountPage\)/.test(PAGE), "the page param must never be parsed raw")
  assert.match(PAGE, /const page = result\.page/)
})
