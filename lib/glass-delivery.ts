import { getSql } from "@/lib/db"
import { recordEvent } from "@/lib/events"
import { hashGlassToken } from "@/lib/glass"
import { sendSmsPersisted } from "@/lib/messages"
import { isReservedShopPhone } from "@/lib/people"
import { isDefinitiveTwilioError } from "@/lib/twilio"

type GlassDelivery = {
  lead_id: number
  phone: string
  person_id: number | null
  is_test: boolean
  sent_at: string | null
  send_attempts: number
  send_status: string
}

export function glassUrl(token: string) {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://musiccityspecialtywelding.com"
  return `${base.replace(/\/$/, "")}/j/${token}`
}

/** Claims one bearer link, then resumes the same persisted SMS intent on retries. */
export async function deliverGlassClipboard(input: { token: string; leadId: number; operatorId: number }) {
  const hash = hashGlassToken(input.token)
  const sql = getSql()
  const claimed = (await sql`
    UPDATE glass_links g SET send_claimed_at = now(), send_status = 'sending', send_attempts = send_attempts + 1
    FROM leads l
    WHERE g.token_hash = ${hash}::text
      AND g.lead_id = ${input.leadId}::bigint
      AND l.id = g.lead_id
      AND g.sent_at IS NULL
      AND g.send_status IN ('pending','failed','sending')
      AND g.revoked_at IS NULL
      AND (g.expires_at IS NULL OR g.expires_at > now())
      AND (g.send_claimed_at IS NULL OR g.send_claimed_at < now() - interval '5 minutes')
    RETURNING g.lead_id, l.phone, l.person_id, l.is_test, g.sent_at, g.send_attempts, g.send_status`) as GlassDelivery[]

  if (!claimed[0]) {
    const existing = (await sql`
      SELECT g.lead_id, l.phone, l.person_id, l.is_test, g.sent_at, g.send_attempts, g.send_status
      FROM glass_links g JOIN leads l ON l.id = g.lead_id
      WHERE g.token_hash = ${hash}::text AND g.lead_id = ${input.leadId}::bigint
        AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())
      LIMIT 1`) as GlassDelivery[]
    if (existing[0]?.sent_at) return { alreadySent: true, messageId: null }
    if (existing[0]?.send_status === "unknown") throw new Error("That Customer Page text may have sent. Check Calls & Messages before trying again.")
    if (existing[0]) throw new Error("That Customer Page is already being sent. Check Calls & Messages before trying again.")
    throw new Error("That Customer Page is no longer active for this job.")
  }

  const lead = claimed[0]
  if (lead.is_test) {
    await sql`
      UPDATE glass_links SET send_claimed_at = NULL, send_status = 'suppressed'
      WHERE token_hash = ${hash}::text AND lead_id = ${input.leadId}::bigint AND sent_at IS NULL`
    return { alreadySent: true, messageId: null }
  }
  try {
    if (!lead.phone || isReservedShopPhone(lead.phone)) throw new Error("This work order needs a customer phone.")
    const url = glassUrl(input.token)
    const sent = await sendSmsPersisted({
      to: lead.phone,
      body: `Track your MCSW job here: ${url}`,
      leadId: input.leadId,
      personId: lead.person_id,
      operatorId: input.operatorId,
      idempotencyKey: `glass:${hash}:send:${lead.send_attempts}`,
    })
    await sql`
      UPDATE glass_links SET sent_at = COALESCE(sent_at, now()), send_claimed_at = NULL, send_status = 'accepted'
      WHERE token_hash = ${hash}::text AND lead_id = ${input.leadId}::bigint`
    await recordEvent({
      kind: "glass.sent",
      actorType: "operator",
      actorId: input.operatorId,
      leadId: input.leadId,
      personId: lead.person_id,
      externalId: `glass:${hash}:sent`,
      body: "Customer Page sent from the shop number",
      crewBody: "Customer Page sent from the shop number",
      detail: { messageId: sent.id },
    })
    return { alreadySent: false, messageId: sent.id }
  } catch (error) {
    await sql`
      UPDATE glass_links SET send_claimed_at = NULL,
        send_status = ${isDefinitiveTwilioError(error) ? "failed" : "unknown"}::text
      WHERE token_hash = ${hash}::text AND lead_id = ${input.leadId}::bigint AND sent_at IS NULL`
    throw error
  }
}
