import { experimental_generateSpeech, generateText } from "ai"
import { gateway } from "@ai-sdk/gateway"
import { put } from "@vercel/blob"
import { AI_MODELS, aiConfigured } from "@/lib/ai"
import { getSql } from "@/lib/db"
import { recordEvent } from "@/lib/events"
import { notifyAll } from "@/lib/notify"
import { isAuthorizedCron } from "@/lib/ops-auth"
import { redactCrewText } from "@/lib/visibility"

export const maxDuration = 60

function centralDay() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
}

function isCentralBriefWindow() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date())
  const hour = Number(parts.find((part) => part.type === "hour")?.value)
  const minute = Number(parts.find((part) => part.type === "minute")?.value)
  const total = hour * 60 + minute
  return total >= 6 * 60 + 30 && total < 12 * 60
}

async function nashvilleWeatherLine(needed: boolean) {
  if (!needed) return ""
  try {
    const headers = { "User-Agent": "MCSW-Shop-Brain/1.0 sales@musiccityspecialtywelding.com", Accept: "application/geo+json" }
    const point = await fetch("https://api.weather.gov/points/36.1627,-86.7816", { headers, cache: "no-store" }).then((response) => response.ok ? response.json() : null) as { properties?: { forecast?: string } } | null
    if (!point?.properties?.forecast) return "Outdoor work is on the board; check conditions before rolling."
    const forecast = await fetch(point.properties.forecast, { headers, cache: "no-store" }).then((response) => response.ok ? response.json() : null) as { properties?: { periods?: Array<{ name?: string; temperature?: number; temperatureUnit?: string; shortForecast?: string }> } } | null
    const today = forecast?.properties?.periods?.[0]
    return today ? `Outdoor work: ${today.shortForecast || "check conditions"}, ${today.temperature ?? "?"}°${today.temperatureUnit || "F"}.` : "Outdoor work is on the board; check conditions before rolling."
  } catch { return "Outdoor work is on the board; check conditions before rolling." }
}

async function shelveBriefAudio(eventId: number, day: string) {
  if (!aiConfigured() || !process.env.BLOB_READ_WRITE_TOKEN) return { status: "unavailable" }
  const sql = getSql()
  const claimed = (await sql`
    UPDATE events SET brief_audio_status = 'submitting', brief_audio_attempts = brief_audio_attempts + 1,
      brief_audio_updated_at = now(), brief_audio_error = ''
    WHERE id = ${eventId}::bigint AND kind = 'brief.morning' AND brief_audio_attempts < 8
      AND (
        brief_audio_status IN ('none','failed')
        OR (brief_audio_status = 'submitting' AND brief_audio_updated_at < now() - interval '10 minutes')
      )
      AND COALESCE(detail->>'audioPath', '') = ''
    RETURNING body, crew_body`) as { body: string; crew_body: string | null }[]
  if (!claimed[0]) return { status: "already-handled" }
  try {
    const voice = process.env.AI_SPEECH_VOICE?.trim() || "onyx"
    const crewText = claimed[0].crew_body || "Your work is waiting in Jobs."
    const [ownerSpeech, crewSpeech] = await Promise.all([
      experimental_generateSpeech({ model: gateway.speechModel(AI_MODELS.speech), text: claimed[0].body, voice, outputFormat: "mp3", speed: 1.02 }),
      experimental_generateSpeech({ model: gateway.speechModel(AI_MODELS.speech), text: crewText, voice, outputFormat: "mp3", speed: 1.02 }),
    ])
    const [ownerBlob, crewBlob] = await Promise.all([
      put(`briefs/${day}-${eventId}-owner.mp3`, Buffer.from(ownerSpeech.audio.uint8Array), { access: "private", contentType: ownerSpeech.audio.mediaType || "audio/mpeg", allowOverwrite: true }),
      put(`briefs/${day}-${eventId}-crew.mp3`, Buffer.from(crewSpeech.audio.uint8Array), { access: "private", contentType: crewSpeech.audio.mediaType || "audio/mpeg", allowOverwrite: true }),
    ])
    await sql`
      UPDATE events SET detail = COALESCE(detail, '{}'::jsonb) || ${JSON.stringify({ audioPath: ownerBlob.pathname, crewAudioPath: crewBlob.pathname, speechModel: AI_MODELS.speech })}::jsonb,
        brief_audio_status = 'completed', brief_audio_updated_at = now(), brief_audio_error = ''
      WHERE id = ${eventId}::bigint`
    return { status: "completed" }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Morning brief speech failed."
    await sql`UPDATE events SET brief_audio_status = 'failed', brief_audio_updated_at = now(), brief_audio_error = ${message.slice(0, 500)}::text WHERE id = ${eventId}::bigint`
    console.error("Morning brief speech failed; the next recovery-window cron will retry:", error)
    return { status: "failed" }
  }
}

export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return Response.json({ ok: false }, { status: 401 })
  if (!isCentralBriefWindow()) return Response.json({ ok: true, skipped: "Outside the 6:30 AM-noon America/Chicago recovery window." })
  const sql = getSql()
  const day = centralDay()
  const existing = (await sql`
    SELECT id, body FROM events WHERE kind = 'brief.morning' AND external_id = ${`brief:${day}`}::text LIMIT 1`) as { id: number; body: string }[]
  if (existing[0]) {
    await notifyAll({ priority: "interrupt", stock: "white", title: "Morning Brief is ready", body: "Open today’s jobs and promises.", url: "/board#radio", sourceEventId: existing[0].id, quietHoursExempt: true, capExempt: true })
    const audio = await shelveBriefAudio(Number(existing[0].id), day)
    return Response.json({ ok: true, resumed: true, eventId: existing[0].id, audio })
  }
  const [promises, unanswered, quotes, invoices, wins, outdoor] = await Promise.all([
    sql`SELECT c.id, c.lead_id, c.summary, c.crew_summary, c.due_at, l.first_name, l.service FROM commitments c LEFT JOIN leads l ON l.id = c.lead_id WHERE c.status = 'open' AND c.due_at < now() + interval '1 day' AND (l.is_test = false OR l.id IS NULL) ORDER BY c.due_at ASC LIMIT 20`.then((rows) => rows as Record<string, unknown>[]),
    sql`SELECT id, first_name, service, created_at FROM leads WHERE is_test = false AND first_response_at IS NULL AND completed_at IS NULL AND status NOT IN ('lost','spam') ORDER BY created_at ASC LIMIT 20`.then((rows) => rows as Record<string, unknown>[]),
    sql`SELECT id, first_name, service, quoted_at FROM leads WHERE is_test = false AND status = 'quoted' AND quoted_at < now() - interval '3 days' ORDER BY quoted_at ASC LIMIT 20`.then((rows) => rows as Record<string, unknown>[]),
    sql`SELECT id, first_name, invoice_number, invoice_due_at FROM leads WHERE is_test = false AND invoiced_at IS NOT NULL AND paid_at IS NULL ORDER BY invoice_due_at ASC NULLS LAST LIMIT 20`.then((rows) => rows as Record<string, unknown>[]),
    sql`SELECT l.first_name, l.service, l.paid_amount_cents, l.revenue_cents,
      COALESCE(o.name, completion.operator_name, 'The crew') AS crew_name
      FROM leads l
      LEFT JOIN LATERAL (
        SELECT e.actor_id, e.detail->>'operatorName' AS operator_name
        FROM events e WHERE e.lead_id = l.id AND e.kind = 'job.completed'
        ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1
      ) completion ON true
      LEFT JOIN operators o ON o.id::text = completion.actor_id
      WHERE l.is_test = false AND l.completed_at > now() - interval '1 day'
      ORDER BY l.completed_at DESC LIMIT 20`.then((rows) => rows as Record<string, unknown>[]),
    sql`SELECT EXISTS(SELECT 1 FROM leads WHERE is_test = false AND completed_at IS NULL AND status NOT IN ('lost','spam') AND (scheduled_at IS NOT NULL OR work_started_at IS NOT NULL) AND service ~* '(mobile|on-site|onsite|outdoor|field|install)') AS needed`.then((rows) => Boolean(((rows as { needed?: boolean }[])[0])?.needed)),
  ])
  const weather = await nashvilleWeatherLine(outdoor)
  const ownerPromiseSheet = promises.map((item) => ({ label: `${item.first_name || "Shop"}: ${item.summary || "promise due"}`, url: item.lead_id ? `/ops/leads/${item.lead_id}#promise-${item.id}` : "/board?signal=promise" }))
  const crewPromiseSheet = promises.map((item) => ({ label: `${item.first_name || "Shop"}: ${item.crew_summary || redactCrewText(String(item.summary || "promise due"))}`, url: item.lead_id ? `/ops/leads/${item.lead_id}#promise-${item.id}` : "/board?signal=promise" }))
  const sharedDaySheet = [
    ...unanswered.map((item) => ({ label: `${item.first_name || "Customer"}: first call`, url: `/ops/leads/${item.id}` })),
    ...quotes.map((item) => ({ label: `${item.first_name || "Customer"}: quote follow-up`, url: `/ops/leads/${item.id}` })),
  ]
  const daySheet: Array<{ label: string; url: string; ownerOnly?: boolean }> = [
    ...ownerPromiseSheet,
    ...sharedDaySheet,
    ...invoices.map((item) => ({ label: `${item.first_name || "Customer"}: invoice ${item.invoice_number || "open"}`, url: `/ops/leads/${item.id}`, ownerOnly: true })),
  ].slice(0, 24)
  const crewDaySheet = [...crewPromiseSheet, ...sharedDaySheet].slice(0, 24)
  const facts = { promises, unanswered, stale_quotes: quotes, unpaid_invoices: invoices, yesterday_wins: wins, weather }
  const crewCredits = wins.map((item) => `${item.crew_name || "The crew"} closed ${item.first_name || "a job"}`).slice(0, 5)
  const crewBody = [
    `Morning. ${promises.length} promises need a look. ${unanswered.length} customers still need a first call.`,
    quotes.length ? `${quotes.length} customers need a follow-up.` : "", weather,
    crewCredits.length ? `Yesterday: ${crewCredits.join(". ")}.` : "",
  ].filter(Boolean).join(" ")
  let text = `Morning. ${promises.length} promises need a look. ${unanswered.length} customers still need a first call. ${quotes.length} quotes are getting stale. ${invoices.length} invoices are still open.`
  let briefModel = "deterministic"
  if (aiConfigured()) {
    try {
      const result = await generateText({ model: AI_MODELS.reasoning, system: "Write a plainspoken morning shop brief in at most 200 words. Put urgent promises and uncalled customers first. Then stale quotes and invoices. Credit crew by first name only for completed work. Never invent. No greeting fluff, no management jargon, no markdown.", prompt: JSON.stringify(facts) })
      text = result.text.trim().split(/\s+/).slice(0, 200).join(" ")
      briefModel = AI_MODELS.reasoning
    } catch (error) {
      console.error("Morning brief AI prose failed; using deterministic copy:", error)
    }
  }
  const eventId = await recordEvent({ kind: "brief.morning", actorType: "ai", externalId: `brief:${day}`, body: text, crewBody, detail: { facts, crewBody, daySheet, crewDaySheet, model: briefModel } })
  if (eventId) await notifyAll({ priority: "interrupt", stock: "white", title: "Morning Brief is ready", body: `${promises.length + unanswered.length + quotes.length} items · about 90 seconds`, url: "/board#radio", sourceEventId: eventId, quietHoursExempt: true, capExempt: true })
  if (eventId) await shelveBriefAudio(eventId, day)
  await sql`INSERT INTO automation_runs (job, ok, detail) VALUES ('morning-brief'::text, true, ${JSON.stringify({ eventId, counts: { promises: promises.length, unanswered: unanswered.length, quotes: quotes.length, invoices: invoices.length } })}::jsonb)`
  return Response.json({ ok: true, eventId, text })
}
