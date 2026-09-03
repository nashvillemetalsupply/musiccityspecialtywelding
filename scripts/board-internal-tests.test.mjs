import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const root = new URL("..", import.meta.url)
const source = (path) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n")

const PAGE = source("app/board/page.tsx")
const BOARD = source("app/board/board.tsx")
const SHOP = source("app/ops/shop/page.tsx")
const DATA = source("lib/ops-data.ts")
const WORK_ORDER = source("app/ops/leads/[id]/page.tsx")
const OPERATORS = source("lib/operators.ts")

test("/board accepts tests as a search param", () => {
  assert.match(PAGE, /type SearchParams = Promise<\{[^}]*tests\?: string[^}]*\}>/)
  assert.match(PAGE, /const includeTests = params\.tests === "1" && Boolean\(operator && canAccessInternalTests\(operator\.role\)\)/)
})

test("only a signed-in owner can turn internal tests on", () => {
  // the URL never gets a vote: the flag is an AND of the typed param and the
  // role the server resolved, so ?tests=1 from crew is the ordinary board
  const gate = PAGE.indexOf('const includeTests = params.tests === "1" && Boolean(operator && canAccessInternalTests(operator.role))')
  const session = PAGE.indexOf("const operator = dbConfigured() ? await getAuthenticatedOperator() : null")
  assert.ok(session > -1 && gate > session, "includeTests must be derived after the session resolves")
  assert.match(OPERATORS, /export function canAccessInternalTests\(role: OperatorRole\) \{\s*return role === "owner"/)
  assert.doesNotMatch(PAGE, /includeTests: true/)
  assert.doesNotMatch(PAGE, /includeTests: params\.tests|includeTests: Boolean\(params\.tests\)/)
  // the flag is never recomputed further down, where role is already narrowed
  assert.equal(PAGE.match(/const includeTests =/g).length, 1)
})

test("the board carries the mode forward but never decides it", () => {
  // chrome is the only way in, and it is built on the server render
  assert.match(PAGE, /const chrome = \{[^}]*includeTests,/s)
  assert.match(BOARD, /type BoardChrome = \{[\s\S]*?includeTests: boolean[\s\S]*?\}/)
  // the client reads the flag; it never derives one from the URL it sits at
  assert.doesNotMatch(BOARD, /useSearchParams|window\.location|location\.search/)
  assert.doesNotMatch(BOARD, /includeTests = |includeTests\?\?|tests === "1"/)
  for (const use of [/if \(chrome\.includeTests\) params\.set\("tests", "1"\)/, /\{chrome\.includeTests && <input type="hidden" name="tests" value="1" \/>\}/]) {
    assert.match(BOARD, use)
  }
  // the stage tabs are the one board link built by hand rather than through
  // boardHref -- they deliberately reset q and signal -- so they append the
  // flag themselves rather than gaining a filter-preserving href
  assert.match(BOARD, /href=\{`\/board\?stage=\$\{stage\}\$\{chrome\.includeTests \? "&tests=1" : ""\}`\}/)
  assert.equal(BOARD.match(/chrome\.includeTests/g).length, 3)
})

test("boardHref keeps tests=1 across every stage and signal hop", () => {
  // the flag is appended inside boardHref, so every link it generates -- the
  // signal chips, the clear-filter link, the attention jump, and any paging
  // link built on it later -- inherits it without a second call site
  const href = BOARD.indexOf("const boardHref = (")
  const stop = BOARD.indexOf("useEffect(", href)
  const body = BOARD.slice(href, stop)
  assert.match(body, /if \(chrome\.includeTests\) params\.set\("tests", "1"\)/)
  // and it is appended after stage, q and signal, so those still decide the URL
  assert.ok(body.indexOf('params.set("stage", stage)') < body.indexOf('params.set("tests", "1")'))
  assert.ok(body.indexOf('params.set("signal", signal)') < body.indexOf('params.set("tests", "1")'))
  // every boardHref consumer therefore stays in test mode; none of them
  // hand-builds a /board URL of its own. The signal chips and the attention
  // jump left the pane on 2026-09-03; clear-filter and paging remain.
  for (const link of [/href=\{boardHref\(\{ signal: null \}\)\}/, /href=\{boardHref\(\{ page: board\.page \+ 1 \}\)\}/]) {
    assert.match(BOARD, link)
  }
})

test("the search form re-submits the mode instead of dropping it", () => {
  assert.match(BOARD, /<form className="find" action="\/board" method="get" role="search"/)
  const form = BOARD.slice(BOARD.indexOf('<form className="find"'), BOARD.indexOf("</form>"))
  assert.match(form, /name="q"/)
  assert.match(form, /\{chrome\.includeTests && <input type="hidden" name="tests" value="1" \/>\}/)
  // crew and signed-out renders get no field at all, so a GET from that header
  // cannot put tests=1 back on the URL
  assert.doesNotMatch(form, /name="tests" value="1" \/>(?!\})/)
})

test("the owner-only flag reaches rows and their batched details", () => {
  assert.match(PAGE, /listBoardJobs\(\{ stage, signal, order: "newest", query, includeTests, page: requestedPage \}, role\)/)
  // stage, signal and query behaviour is untouched by the flag
  assert.match(PAGE, /JOB_BOARD_STAGES\.includes\(requested as JobBoardStage\)/)
  assert.match(PAGE, /BOARD_SIGNAL_KINDS\.includes\(requestedSignal as BoardSignalKind\)/)
  assert.match(PAGE, /const query = params\.q\?\.trim\(\)\.slice\(0, 80\) \?\? ""/)
  // every other projection still carries the server-resolved role; only the
  // selected row details opt into test facts.
  for (const call of [/getOutTheDoorWeek\(role\)/, /getOpsStats\(role\)/, /listTodayEvents\(role\)/, /getBoardJobDetails\(page\.items\.map\(\(item\) => item\.id\), role, includeTests\)/]) {
    assert.match(PAGE, call)
  }
})

test("direct work-order URLs resolve the test partition from the role", () => {
  assert.match(WORK_ORDER, /const includeTests = canAccessInternalTests\(operator\.role\)/)
  assert.match(WORK_ORDER, /const lead = await getLead\(leadId, operator\.role, \{ includeTests \}\)/)
  assert.ok(WORK_ORDER.indexOf("const lead = await getLead") < WORK_ORDER.indexOf("Promise.all(["), "authorize the lead before loading related facts")
  assert.match(WORK_ORDER, /listCommitments\(\{ leadId, status: "open", includeTests \}\)/)
  assert.match(WORK_ORDER, /listJobLineItems\(leadId, operator\.role, includeTests\)/)
  assert.doesNotMatch(WORK_ORDER, /includeTests: true/)
})

test("business metrics never take the test flag", () => {
  // promises, out-the-door and stats are business numbers; a test row that
  // reached them would count as revenue
  assert.doesNotMatch(PAGE, /getPromiseSummary\(includeTests|getOutTheDoorWeek\([^)]*includeTests|getOpsStats\([^)]*includeTests/)
  // no per-worker counting sneaks in with the flag
  assert.doesNotMatch(PAGE, /leaderboard|per-worker|responseRank|hoursWorked/i)
  assert.doesNotMatch(BOARD, /leaderboard|per-worker|responseRank|hoursWorked/i)
})

test("listBoardJobs already supports the flag with an explicit boolean cast", () => {
  assert.match(DATA, /includeTests\?: boolean/)
  assert.match(DATA, /const includeTests = options\.includeTests \?\? false/)
  // Neon 42P18: the interpolation names its type at every use site
  assert.match(DATA, /\$\{includeTests\}::boolean OR l\.is_test = false/)
  assert.doesNotMatch(DATA, /\$\{includeTests\}(?!::boolean)/)
})

test("Settings points Internal tests at the board, not the retired view", () => {
  assert.match(SHOP, /href="\/board\?tests=1">Internal tests<\/Link>/)
  assert.doesNotMatch(SHOP, /\/ops\?status=open&tests=1/)
  // the link stays inside the owner-only body: crew returns before it renders
  const crewReturn = SHOP.indexOf('if (operator.role !== "owner")')
  assert.ok(crewReturn > -1 && crewReturn < SHOP.indexOf('href="/board?tests=1"'))
})
