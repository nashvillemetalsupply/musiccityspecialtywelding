import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const OPS_DATA_SOURCE = readFileSync(new URL("../lib/ops-data.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n")
const BOARD_SOURCE = readFileSync(new URL("../app/board/board.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n")

test("board ordering keeps stage, oldest, and newest only", () => {
  assert.match(OPS_DATA_SOURCE, /export type BoardJobOrder = "stage" \| "oldest" \| "newest"/)
  assert.match(OPS_DATA_SOURCE, /options\.order === "oldest" \? "oldest" : options\.order === "newest" \? "newest" : "stage"/)
  assert.match(OPS_DATA_SOURCE, /CASE WHEN \$\{order\}::text = 'stage' THEN/)
  assert.match(OPS_DATA_SOURCE, /CASE WHEN \$\{order\}::text = 'oldest' THEN f\.board_since END ASC NULLS LAST/)
  assert.match(OPS_DATA_SOURCE, /CASE WHEN \$\{order\}::text = 'newest' THEN f\.created_at END DESC NULLS LAST/)
  assert.doesNotMatch(OPS_DATA_SOURCE, /\b(?:BOARD_WEIGHTS|board_score|board_signals|board_hot|signal_weight|hours_late)\b|'weight'/)
})

test("board stop/warn chip keeps its signal meaning without a score payload", () => {
  assert.match(OPS_DATA_SOURCE, /bool_or\(kind IN \('waiting','noreply'\)\) AS stop_signal/)
  assert.match(OPS_DATA_SOURCE, /COALESCE\(n\.stop_signal, false\) AS board_stop_signal/)
  assert.match(BOARD_SOURCE, /return lead\.board_stop_signal \? "stop" : "warn"/)
})
