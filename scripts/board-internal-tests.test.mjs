import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const root = new URL("..", import.meta.url)
const source = (path) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n")

const PAGE = source("app/board/page.tsx")
const SHOP = source("app/ops/shop/page.tsx")
const DATA = source("lib/ops-data.ts")

test("/board accepts tests as a search param", () => {
  assert.match(PAGE, /type SearchParams = Promise<\{[^}]*tests\?: string[^}]*\}>/)
  assert.match(PAGE, /const includeTests = params\.tests === "1" && role === "owner"/)
})

test("only a signed-in owner can turn internal tests on", () => {
  // the URL never gets a vote: the flag is an AND of the typed param and the
  // role the server resolved, so ?tests=1 from crew is the ordinary board
  const gate = PAGE.indexOf('const includeTests = params.tests === "1" && role === "owner"')
  const roleLine = PAGE.indexOf("const role = operator.role")
  assert.ok(roleLine > -1 && gate > roleLine, "includeTests must be derived after the session role")
  // the signed-out return happens before the flag exists at all, and it hands
  // back the structural zero state rather than any query
  const signedOut = PAGE.indexOf("if (!operator) return <JobControl board={{ ...EMPTY_BOARD")
  assert.ok(signedOut > -1 && signedOut < gate, "signed-out requests must return before includeTests")
  assert.doesNotMatch(PAGE, /includeTests: true/)
  assert.doesNotMatch(PAGE, /includeTests: params\.tests|includeTests: Boolean\(params\.tests\)/)
  // no client-side hiding: the flag is only ever spent on the server query
  assert.equal(PAGE.match(/includeTests/g).length, 2)
})

test("the flag is spent on the existing listBoardJobs query and nothing else", () => {
  assert.match(PAGE, /listBoardJobs\(\{ stage, signal, order: "oldest", query, includeTests \}, role\)/)
  // stage, signal and query behaviour is untouched by the flag
  assert.match(PAGE, /JOB_BOARD_STAGES\.includes\(requested as JobBoardStage\)/)
  assert.match(PAGE, /BOARD_SIGNAL_KINDS\.includes\(requestedSignal as BoardSignalKind\)/)
  assert.match(PAGE, /const query = params\.q\?\.trim\(\)\.slice\(0, 80\) \?\? ""/)
  // every other projection still carries the server-resolved role
  for (const call of [/getOutTheDoorWeek\(role\)/, /getOpsStats\(role\)/, /listTodayEvents\(role\)/, /getBoardJobDetails\(page\.items\.map\(\(item\) => item\.id\), role\)/]) {
    assert.match(PAGE, call)
  }
})

test("business metrics never take the test flag", () => {
  // promises, out-the-door and stats are business numbers; a test row that
  // reached them would count as revenue
  assert.doesNotMatch(PAGE, /getPromiseSummary\(includeTests|getOutTheDoorWeek\([^)]*includeTests|getOpsStats\([^)]*includeTests/)
  // no per-worker counting sneaks in with the flag
  assert.doesNotMatch(PAGE, /leaderboard|per-worker|responseRank|hoursWorked/i)
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
