import { getSql } from "@/lib/db"
import { operatorSignature } from "@/lib/operators"
import {
  deriveVoiceProfile, emptyVoiceProfile, voiceProfileIsUsable, voiceStyleGuide,
  type VoiceProfile,
} from "@/lib/voice-of-character.mjs"

// One speaker exists, and it is the owner. Crew voices are deliberately not
// collected: a per-person language corpus is surveillance wearing a costume.
export const OWNER_VOICE_KEY = "owner"

// The corpus is meant to grow for years, so the read is bounded rather than
// unbounded. Twenty thousand lines is far more than the derivation needs and
// far more than the shop will say in a decade of calls.
const CORPUS_LIMIT = 20_000

// A pasted piece of his writing is split into sentences before it is stored,
// so one paste does not land as a single 400-word "line" and flatten every
// statistic the profile keeps.
const MAX_MANUAL_CHARS = 20_000

export type VoiceSampleCounts = { kind: string; samples: number; sources: number }[]

async function ownerDisplayName() {
  const sql = getSql()
  const rows = (await sql`
    SELECT name, signature_name, role FROM operators
    WHERE role = 'owner' AND active = true
    ORDER BY created_at ASC LIMIT 1`) as { name: string; signature_name: string; role: "owner" }[]
  return rows[0] ? operatorSignature(rows[0]) : ""
}

// Idempotent by (kind, ref, sequence): the same call can be captured on every
// webhook retry and lands once. The shop's own track is the one selected --
// `speakerForTrack` in the sketch store draws the same line, and both must
// agree or the corpus fills with the customer's words.
export async function captureCallVoiceSamples(callSid: string) {
  const sql = getSql()
  const rows = (await sql`
    INSERT INTO voice_samples (speaker_key, source_kind, source_ref, sequence_id, text, spoken_at, is_test)
    SELECT ${OWNER_VOICE_KEY}::text, 'call'::text, i.call_sid, i.sequence_id::int,
      btrim(i.transcript)::text,
      COALESCE(i.provider_timestamp, c.started_at)::timestamptz,
      (lower(COALESCE(c.detail->>'isTest', 'false')) = 'true'
        OR COALESCE(l.is_test, false) OR COALESCE(p.is_test, false))::boolean
    FROM call_live_transcript_items i
    JOIN calls c ON c.twilio_sid = i.call_sid
    LEFT JOIN leads l ON l.id = c.lead_id
    LEFT JOIN people p ON p.id = c.person_id
    WHERE i.call_sid = ${callSid}::text
      AND i.is_final = true
      AND btrim(i.transcript) <> ''
      AND i.track = CASE WHEN c.direction = 'out' THEN 'inbound_track' ELSE 'outbound_track' END
    ON CONFLICT (speaker_key, source_kind, source_ref, sequence_id) DO NOTHING
    RETURNING id`) as { id: number }[]
  return rows.length
}

// Everything the shop already holds in his own words, swept in one pass:
// every call he has been on, and every note he dictated or typed himself.
//
// Outbound texts and emails are deliberately not swept. `sendSmsPersisted`
// stores an operator id for messages the app composed as well as ones he typed,
// and the email paths run through templates -- feeding either back in would
// teach the machine to imitate its own copy and call it his voice.
// ponytail: add sms/email once a message records whether a human typed it.
export async function backfillOwnerVoiceSamples() {
  const sql = getSql()
  const calls = (await sql`
    INSERT INTO voice_samples (speaker_key, source_kind, source_ref, sequence_id, text, spoken_at, is_test)
    SELECT ${OWNER_VOICE_KEY}::text, 'call'::text, i.call_sid, i.sequence_id::int,
      btrim(i.transcript)::text,
      COALESCE(i.provider_timestamp, c.started_at)::timestamptz,
      (lower(COALESCE(c.detail->>'isTest', 'false')) = 'true'
        OR COALESCE(l.is_test, false) OR COALESCE(p.is_test, false))::boolean
    FROM call_live_transcript_items i
    JOIN calls c ON c.twilio_sid = i.call_sid
    LEFT JOIN leads l ON l.id = c.lead_id
    LEFT JOIN people p ON p.id = c.person_id
    WHERE i.is_final = true
      AND btrim(i.transcript) <> ''
      AND i.track = CASE WHEN c.direction = 'out' THEN 'inbound_track' ELSE 'outbound_track' END
    ON CONFLICT (speaker_key, source_kind, source_ref, sequence_id) DO NOTHING
    RETURNING id`) as { id: number }[]
  const notes = (await sql`
    INSERT INTO voice_samples (speaker_key, source_kind, source_ref, sequence_id, text, spoken_at, is_test)
    SELECT ${OWNER_VOICE_KEY}::text, 'note'::text, e.id::text, 0::int,
      btrim(e.body)::text, e.occurred_at::timestamptz,
      (lower(COALESCE(e.detail->>'isTest', 'false')) = 'true'
        OR COALESCE(l.is_test, false) OR COALESCE(p.is_test, false))::boolean
    FROM events e
    JOIN operators o ON o.id::text = e.actor_id AND o.role = 'owner'
    LEFT JOIN leads l ON l.id = e.lead_id
    LEFT JOIN people p ON p.id = e.person_id
    WHERE e.kind = ANY(ARRAY['note.voice','note.text']::text[])
      AND e.actor_type = 'operator'
      AND btrim(e.body) <> ''
      AND btrim(e.body) <> 'Closeout media filed'
    ON CONFLICT (speaker_key, source_kind, source_ref, sequence_id) DO NOTHING
    RETURNING id`) as { id: number }[]
  return { calls: calls.length, notes: notes.length }
}

// The fast way to make the corpus long enough to be worth drafting from: he
// pastes something he wrote, in his words, and it is stored sentence by
// sentence under one reference.
export async function addManualVoiceSample(input: { text: string; label?: string }) {
  const sql = getSql()
  const text = String(input.text ?? "").replace(/\r\n/g, "\n").trim().slice(0, MAX_MANUAL_CHARS)
  if (!text) return { added: 0, sourceRef: "" }
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length > 1)
  if (!sentences.length) return { added: 0, sourceRef: "" }
  const label = String(input.label ?? "").replace(/\s+/g, "-").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40)
  // The clock is the reference so two pastes can never collide and be dropped
  // by the conflict guard, which is there to absorb a double submit of the
  // same paste, not to lose a second one.
  const sourceRef = `${label || "paste"}-${Date.now()}`
  let added = 0
  for (const [index, sentence] of sentences.entries()) {
    const inserted = (await sql`
      INSERT INTO voice_samples (speaker_key, source_kind, source_ref, sequence_id, text, spoken_at, is_test)
      VALUES (${OWNER_VOICE_KEY}::text, 'manual'::text, ${sourceRef}::text, ${index}::int,
        ${sentence}::text, now()::timestamptz, false::boolean)
      ON CONFLICT (speaker_key, source_kind, source_ref, sequence_id) DO NOTHING
      RETURNING id`) as { id: number }[]
    added += inserted.length
  }
  return { added, sourceRef }
}

async function ownerCorpus() {
  const sql = getSql()
  // A test call never becomes the owner's voice, and the flag rides the row so
  // a corpus built before the flag was known can still be rebuilt correctly.
  return (await sql`
    SELECT source_kind, source_ref, text
    FROM voice_samples
    WHERE speaker_key = ${OWNER_VOICE_KEY}::text AND is_test = false
    ORDER BY spoken_at ASC NULLS LAST, id ASC
    LIMIT ${CORPUS_LIMIT}::int`) as { source_kind: string; source_ref: string; text: string }[]
}

export async function rebuildOwnerVoiceProfile(): Promise<VoiceProfile> {
  const sql = getSql()
  const [rows, displayName] = await Promise.all([ownerCorpus(), ownerDisplayName()])
  const profile = deriveVoiceProfile(
    rows.map((row) => ({ sourceRef: `${row.source_kind}:${row.source_ref}`, text: row.text })),
    { displayName },
  )
  await sql`
    INSERT INTO voice_profiles (speaker_key, display_name, profile, sample_count, source_count, built_at, updated_at)
    VALUES (${OWNER_VOICE_KEY}::text, ${displayName}::text, ${JSON.stringify(profile)}::jsonb,
      ${profile.lineCount}::int, ${profile.sourceCount}::int, now()::timestamptz, now()::timestamptz)
    ON CONFLICT (speaker_key) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      profile = EXCLUDED.profile,
      sample_count = EXCLUDED.sample_count,
      source_count = EXCLUDED.source_count,
      built_at = EXCLUDED.built_at,
      updated_at = now()`
  return profile
}

export async function getOwnerVoiceProfile(): Promise<VoiceProfile | null> {
  const sql = getSql()
  const rows = (await sql`
    SELECT profile FROM voice_profiles
    WHERE speaker_key = ${OWNER_VOICE_KEY}::text LIMIT 1`) as { profile: VoiceProfile | null }[]
  const profile = rows[0]?.profile
  if (!profile) return null
  return { ...emptyVoiceProfile(), ...profile }
}

// What every drafting path -- voicemail script, text, email, page copy, ad --
// pastes into its prompt. An empty string means the shop has not recorded
// enough of him yet, and the caller must draft in the plain shop voice rather
// than pretend.
export async function ownerVoiceGuide() {
  const profile = await getOwnerVoiceProfile()
  return voiceProfileIsUsable(profile) ? voiceStyleGuide(profile) : ""
}

// What the board shows above the preview button: how much of him is on record
// right now. It is the honest version of "his voice is getting closer" -- the
// number goes up as calls land, and the preview is drawn from whatever it says.
export type OwnerVoiceSnapshot = {
  displayName: string
  lineCount: number
  sourceCount: number
  usable: boolean
  builtAt: string | null
}

export async function getOwnerVoiceSnapshot(): Promise<OwnerVoiceSnapshot | null> {
  const sql = getSql()
  const rows = (await sql`
    SELECT display_name, sample_count, source_count, built_at, profile
    FROM voice_profiles WHERE speaker_key = ${OWNER_VOICE_KEY}::text LIMIT 1`) as Array<{
      display_name: string
      sample_count: number
      source_count: number
      built_at: string | null
      profile: VoiceProfile | null
    }>
  const row = rows[0]
  if (!row) return null
  return {
    displayName: row.display_name || "",
    lineCount: Number(row.sample_count ?? 0),
    sourceCount: Number(row.source_count ?? 0),
    usable: voiceProfileIsUsable(row.profile),
    builtAt: row.built_at ? new Date(row.built_at).toISOString() : null,
  }
}

export async function ownerVoiceSampleCounts(): Promise<VoiceSampleCounts> {
  const sql = getSql()
  return (await sql`
    SELECT source_kind AS kind, count(*)::int AS samples, count(DISTINCT source_ref)::int AS sources
    FROM voice_samples
    WHERE speaker_key = ${OWNER_VOICE_KEY}::text AND is_test = false
    GROUP BY source_kind
    ORDER BY source_kind ASC`) as VoiceSampleCounts
}
