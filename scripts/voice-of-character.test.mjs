import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  deriveVoiceProfile, emptyVoiceProfile, normalizeLine, voiceProfileIsUsable, voiceStyleGuide,
} from "../lib/voice-of-character.mjs"

const STORE_SOURCE = readFileSync(new URL("../lib/voice-of-character.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n")
const SKETCH_SOURCE = readFileSync(new URL("../lib/call-sketch-store.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n")
const PREVIEW_SOURCE = readFileSync(new URL("../app/api/ops/voice/preview/route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n")
const MIGRATE_SOURCE = readFileSync(new URL("./migrate.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n")

// Two calls, one voice: the same man opening the same way and saying the same
// things about lead time both times.
function twoCalls() {
  const first = [
    "Music City Specialty Welding, this is Philip.",
    "Yeah, we can build that gate for you.",
    "What's the opening measure, out to out?",
    "Okay, so about twelve foot. That's a two-leaf then.",
    "I'd say give me about two weeks on it.",
    "Give me a call back when you get that measurement.",
  ]
  const second = [
    "Music City Specialty Welding, this is Philip.",
    "Yeah, we can build that for you, no problem.",
    "Is that going on a wood post or a steel post?",
    "I'd say give me about two weeks on it.",
    "Give me a call back when you know.",
  ]
  return [
    ...first.map((text) => ({ sourceRef: "call:CA1", text })),
    ...second.map((text) => ({ sourceRef: "call:CA2", text })),
  ]
}

test("the profile is built from his own lines, grouped by the call they came from", () => {
  const profile = deriveVoiceProfile(twoCalls(), { displayName: "Philip" })
  assert.equal(profile.sourceCount, 2)
  assert.equal(profile.lineCount, 11)
  assert.equal(profile.displayName, "Philip")
  assert.ok(profile.wordsPerLine > 4, "his sentences are short but they are sentences")
})

test("how he opens and how he signs off are kept separately", () => {
  const profile = deriveVoiceProfile(twoCalls())
  assert.equal(profile.openers[0].text, "Music City Specialty Welding, this is Philip.")
  assert.equal(profile.openers[0].count, 2, "he answers the phone the same way every time")
  assert.match(profile.closers[0].text, /^Give me a call back/)
})

test("a phrase has to recur across calls, and the longer form wins", () => {
  const profile = deriveVoiceProfile(twoCalls())
  const phrases = profile.phrases.map((entry) => entry.text)
  assert.ok(phrases.some((phrase) => phrase.includes("give me about two weeks on it")), `kept phrases were ${phrases.join(" | ")}`)
  assert.ok(!phrases.includes("two weeks"), "the short gram inside a kept phrase is not also a phrase")
  assert.ok(!phrases.includes("give me about two"), "nor is any other fragment of it")
  for (const entry of profile.phrases) assert.ok(entry.sources >= 2, `"${entry.text}" was said in only one call`)
})

test("his habits and his own sentences both survive into the profile", () => {
  const profile = deriveVoiceProfile(twoCalls())
  assert.ok(profile.tics.some((entry) => entry.text === "yeah"))
  assert.ok(profile.tics.some((entry) => entry.text === "no problem"))
  assert.ok(profile.samples.length > 0)
  assert.ok(profile.samples.every((sample) => sample.split(" ").length >= 4))
  // He answers the phone identically on both calls; the second copy does not
  // take a slot away from a sentence that shows something new.
  assert.equal(new Set(profile.samples).size, profile.samples.length)
})

test("a test call never becomes the owner's voice", () => {
  const lines = [...twoCalls(), { sourceRef: "call:CA9", text: "[INTERNAL TEST] This is a wire check, ignore it." }]
  const profile = deriveVoiceProfile(lines)
  assert.equal(profile.sourceCount, 2, "the test call contributed no source")
  assert.ok(!JSON.stringify(profile).includes("wire check"))
  // And the corpus read excludes it in SQL as well, so a flagged row cannot
  // reach the derivation in the first place.
  assert.match(STORE_SOURCE, /WHERE speaker_key = \$\{OWNER_VOICE_KEY\}::text AND is_test = false/)
})

test("nothing is drafted in his voice until there is enough of him on record", () => {
  assert.equal(voiceProfileIsUsable(emptyVoiceProfile()), false)
  assert.equal(voiceStyleGuide(emptyVoiceProfile()), "")
  const thin = deriveVoiceProfile([{ sourceRef: "call:CA1", text: "Yeah, we can do that." }])
  assert.equal(voiceProfileIsUsable(thin), false)
  assert.equal(voiceStyleGuide(thin), "", "a thin profile drafts nothing rather than inventing cadence")
  assert.match(PREVIEW_SOURCE, /if \(!profile \|\| !voiceProfileIsUsable\(profile\) \|\| !guide\)/)
})

test("the style guide carries his verbatim words, not only statistics", () => {
  const guide = voiceStyleGuide(deriveVoiceProfile(twoCalls(), { displayName: "Philip" }))
  assert.match(guide, /How Philip talks/)
  assert.match(guide, /His own words, verbatim:/)
  assert.match(guide, /Give me a call back/)
  assert.match(guide, /never a licence to invent one/, "sounding like him is not permission to make facts up")
})

test("the shop's own half of the call is what is captured, and only that", () => {
  // The same track rule `speakerForTrack` draws in the sketch store. If these
  // two ever disagree the corpus fills with the customer's words under his name.
  assert.match(SKETCH_SOURCE, /const shopTrack = direction === "out" \? "inbound_track" : "outbound_track"/)
  assert.match(STORE_SOURCE, /i\.track = CASE WHEN c\.direction = 'out' THEN 'inbound_track' ELSE 'outbound_track' END/)
})

test("a call teaches the voice once its transcript exists, and never breaks the call", () => {
  const stopped = SKETCH_SOURCE.slice(SKETCH_SOURCE.indexOf(`if (input.event === "transcription-stopped")`))
  const capture = stopped.indexOf("captureCallVoiceSamples")
  const transcript = stopped.indexOf("transcript_status = 'ready'")
  assert.ok(transcript >= 0 && capture > transcript, "the receipt is written before the voice is learned from it")
  assert.match(stopped, /if \(!call\.is_test\) \{/)
  assert.match(stopped, /catch \(error\) \{\s*\n\s*console\.error\("Voice-of-character capture failed:", error\)/)
})

test("the corpus rows carry the test flag and are unique by where they came from", () => {
  assert.match(MIGRATE_SOURCE, /CREATE TABLE IF NOT EXISTS voice_samples/)
  assert.match(MIGRATE_SOURCE, /UNIQUE \(speaker_key, source_kind, source_ref, sequence_id\)/)
  assert.match(MIGRATE_SOURCE, /is_test BOOLEAN NOT NULL DEFAULT false/)
  assert.match(MIGRATE_SOURCE, /CREATE TABLE IF NOT EXISTS voice_profiles/)
  // Idempotent inserts: a webhook retry re-captures the same call and adds none.
  assert.match(STORE_SOURCE, /ON CONFLICT \(speaker_key, source_kind, source_ref, sequence_id\) DO NOTHING/)
})

test("the preview persists its intent before it calls a provider", () => {
  const record = PREVIEW_SOURCE.indexOf("recordEvent(")
  const draft = PREVIEW_SOURCE.indexOf("generateText(")
  const speech = PREVIEW_SOURCE.indexOf("experimental_generateSpeech(")
  assert.ok(record > 0 && record < draft && draft < speech, "intent is written before any AI call")
  assert.match(PREVIEW_SOURCE, /operator\.role !== "owner"/)
  // The scenario is chosen from a fixed set, so the button cannot be turned
  // into a way to make the shop say an arbitrary sentence in his name.
  assert.match(PREVIEW_SOURCE, /\(Object\.keys\(SCENARIOS\) as Scenario\[\]\)\.includes/)
})

test("normalizing a line is what makes two of the same greeting one", () => {
  assert.equal(normalizeLine("Music City Specialty Welding, this is Philip."), "music city specialty welding this is philip")
  assert.equal(normalizeLine("  MUSIC city   Specialty Welding this is Philip  "), "music city specialty welding this is philip")
})
