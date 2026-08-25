// Re-derives every unconfirmed call sketch from the final transcript already on
// file, and writes back only the ones that change.
//
// The sketch parser used to take any sentence containing "frame" or "panel" as
// the customer specifying a rectangular frame, and "that's a very kind of gate"
// as the customer specifying a gate. Four production rows carry a kind nobody
// on the call ever asked for. New calls are parsed correctly; these rows were
// written before the fix and would otherwise keep their wrong answer forever.
//
// Safe to run repeatedly. It never touches a confirmed sketch — an owner's
// confirmation is the one thing on this table a script must not overwrite —
// and it never invents utterances, so a row whose transcript is gone is left
// exactly as it is.
//
//   node scripts/repair-call-sketches.mjs           # report only
//   node scripts/repair-call-sketches.mjs --apply   # write the changed rows

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

const apply = process.argv.includes("--apply")
const databaseUrl = envValue("DATABASE_URL")
if (!databaseUrl) throw new Error("DATABASE_URL is not configured.")
const sql = neon(databaseUrl)

// An owner-confirmed sketch is a decision, not an observation. Left alone.
const rows = await sql`
  SELECT call_sid, status, observed_spec
  FROM call_sketches
  WHERE status <> 'confirmed' AND confirmed_spec IS NULL
  ORDER BY updated_at DESC`

let examined = 0
let changed = 0
for (const row of rows) {
  const items = await sql`
    SELECT sequence_id, track, transcript
    FROM call_live_transcript_items
    WHERE call_sid = ${row.call_sid}::text AND is_final = true
    ORDER BY sequence_id ASC
    LIMIT 2000`
  let utterances = items.map((item) => ({
    sequenceId: Number(item.sequence_id),
    track: item.track,
    transcript: item.transcript,
  }))
  // The per-utterance rows are swept for some calls, but the joined transcript
  // on the call receipt is kept forever. It carries the same words and the
  // same speakers, so a sketch whose items are gone is still repairable —
  // which matters, because those are the oldest rows and the likeliest wrong.
  if (!utterances.length) {
    const calls = await sql`
      SELECT direction, transcript FROM calls WHERE twilio_sid = ${row.call_sid}::text LIMIT 1`
    const call = calls[0]
    if (!call?.transcript) continue
    const shopTrack = call.direction === "out" ? "inbound_track" : "outbound_track"
    utterances = String(call.transcript).split("\n")
      .map((line, index) => {
        const match = line.match(/^(Shop|Customer):\s*(.*)$/)
        if (!match || !match[2].trim()) return null
        return {
          sequenceId: index + 1,
          track: match[1] === "Shop" ? shopTrack : (shopTrack === "outbound_track" ? "inbound_track" : "outbound_track"),
          transcript: match[2].trim(),
        }
      })
      .filter(Boolean)
    if (!utterances.length) continue
  }
  examined += 1
  const rebuilt = deriveCallSketch(utterances)
  const before = row.observed_spec ?? {}
  const moved = ["kind", "width", "height", "stockSize", "railCount", "hingeSide", "latchSide", "swing", "material"]
    .filter((key) => (before[key]?.value ?? null) !== (rebuilt[key]?.value ?? null))
  if (!moved.length) continue
  changed += 1
  const detail = moved.map((key) => `${key}: ${JSON.stringify(before[key]?.value ?? null)} -> ${JSON.stringify(rebuilt[key]?.value ?? null)}`)
  console.log(`${row.call_sid}  ${detail.join(", ")}`)
  if (apply) {
    // The watermark is untouched: this rewrites what the same transcript means,
    // not how much of it has been seen, so a late final utterance still lands.
    await sql`
      UPDATE call_sketches
      SET observed_spec = ${JSON.stringify(rebuilt)}::jsonb, updated_at = now()
      WHERE call_sid = ${row.call_sid}::text AND status <> 'confirmed' AND confirmed_spec IS NULL`
  }
}

console.log(`\n${examined} sketch${examined === 1 ? "" : "es"} with a transcript, ${changed} changed.`)
console.log(apply ? "Written." : "Report only. Re-run with --apply to write.")
