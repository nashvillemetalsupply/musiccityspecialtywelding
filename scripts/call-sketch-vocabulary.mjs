// What the shop's callers actually say, and how much of it the sketch parser
// understands.
//
// The parser is a pile of regexes written against imagined phrasings. The
// database is the real thing: every call this shop has taken, transcribed.
// This sweeps the real transcripts, pulls every line that sounds like it is
// describing work or a measurement, runs the parser over each one on its own,
// and prints what it caught and what it walked past.
//
// Read-only. It writes nothing, and it never reads a test call — a rehearsal
// call is the owner speaking the parser's own vocabulary back at it, which is
// exactly the evidence that would flatter it.
//
//   node scripts/call-sketch-vocabulary.mjs           # the misses
//   node scripts/call-sketch-vocabulary.mjs --all     # every candidate line

import { existsSync, readFileSync } from "node:fs"
import { neon } from "@neondatabase/serverless"
import { deriveCallSketch } from "../lib/call-sketch-live.mjs"

function envValue(name) {
  if (process.env[name]?.trim()) return process.env[name].trim()
  for (const file of [".env.local", ".env.vercel.production"]) {
    if (!existsSync(file)) continue
    const found = readFileSync(file, "utf8").match(new RegExp(`^${name}="?([^"\\r\\n]+)`, "m"))?.[1]
    if (found) return found
  }
  return ""
}

const showAll = process.argv.includes("--all")
const databaseUrl = envValue("DATABASE_URL")
if (!databaseUrl) throw new Error("DATABASE_URL is not configured.")
const sql = neon(databaseUrl)

// A line worth looking at: it names something the shop builds, or it carries a
// measurement. Deliberately wider than the parser — the gap is the point.
const SHOP_WORD = /\b(gate|gates|frame|frames|panel|panels|rail|rails|picket|pickets|hinge|hinges|latch|latches|tube|tubing|stock|steel|aluminum|stainless|handrail|railing|fence|post|posts|bracket|opening|swing|swings|weld|welded)\b/i
const NUMBER = /(\b\d+(?:\.\d+)?\b|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b)/i
const UNIT = /\b(feet|foot|ft|inches|inch|in)\b|["']/i

const FACTS = ["kind", "width", "height", "stockSize", "railCount", "hingeSide", "latchSide", "swing", "material"]

const rows = await sql`
  SELECT twilio_sid, started_at, transcript FROM calls
  WHERE transcript IS NOT NULL AND transcript <> ''
    AND lower(COALESCE(detail->>'isTest', 'false')) <> 'true'
  ORDER BY started_at DESC`

const caught = []
const missed = []
let candidates = 0

for (const call of rows) {
  for (const raw of String(call.transcript).split("\n")) {
    const line = raw.replace(/^(Shop|Customer):\s*/, "").trim()
    if (!line) continue
    const speaker = raw.startsWith("Shop:") ? "Shop" : "Customer"
    const measured = NUMBER.test(line) && UNIT.test(line)
    if (!SHOP_WORD.test(line) && !measured) continue
    candidates += 1
    const spec = deriveCallSketch([{ sequenceId: 1, track: speaker === "Shop" ? "outbound_track" : "inbound_track", transcript: line }])
    const got = FACTS.filter((key) => spec[key]?.value != null)
      .map((key) => `${key}=${spec[key].value}${spec[key].truth === "uncertain" ? "?" : ""}`)
    const entry = { sid: call.twilio_sid.slice(0, 12), day: String(call.started_at).slice(0, 10), speaker, line: line.slice(0, 140), got }
    if (got.length) caught.push(entry)
    else missed.push(entry)
  }
}

function print(title, entries) {
  console.log(`\n${title} (${entries.length})`)
  console.log("-".repeat(title.length + 8))
  for (const e of entries) {
    console.log(`  ${e.day} ${e.speaker.padEnd(8)} ${JSON.stringify(e.line)}`)
    if (e.got.length) console.log(`${" ".repeat(22)}-> ${e.got.join(", ")}`)
  }
}

if (showAll) print("UNDERSTOOD", caught)
print("WALKED PAST — real lines the parser took nothing from", missed)

console.log(`\n${rows.length} real calls, ${candidates} candidate lines, ${caught.length} understood, ${missed.length} not.`)
console.log("Every line above is a phrasing this shop's callers actually used.")
