import { getSql } from "@/lib/db"
import { applyLeadStatus, completeLeadRecord, recordPaymentRecord } from "@/lib/job-commands"
import { canAccessInternalTests, getOperatorByPhone, requireLeadMutationAccess, type Operator } from "@/lib/operators"
import { journalOperatorCommand } from "@/lib/operator-command-journal"
import { normalizePhone } from "@/lib/people"
import { isRoofJobBusiness, recordSmsCountRoofJobs, roofJobRowsForSmsCount } from "@/lib/roof-jobs"
import {
  ambiguousReply,
  businessReply,
  candidateName,
  nameReadings,
  noMatchReply,
  OPERATOR_COMMAND_EVENT_KIND,
  parseOperatorCommand,
  successReply,
  type CommandCandidate,
  type OperatorCommandVerb,
  type ParsedOperatorCommand,
} from "@/lib/sms-operator-commands"

type CommandLead = CommandCandidate & { status: string; completed_at: string | null; paid_at: string | null }

export type OperatorTextResult = { reply: string }

async function operatorForPhone(from: string): Promise<Operator | null> {
  const exact = await getOperatorByPhone(from)
  if (exact) return exact
  const normalized = normalizePhone(from)
  return normalized && normalized !== from ? getOperatorByPhone(normalized) : null
}

async function findLeadById(id: number): Promise<CommandLead | null> {
  const rows = (await getSql()`
    SELECT id, first_name, last_name, service, status, completed_at, paid_at
    FROM leads WHERE id = ${id}::bigint LIMIT 1`) as CommandLead[]
  return rows[0] ? { ...rows[0], id: Number(rows[0].id) } : null
}

// A name must match exactly one open job from the last 90 days. `paid` also
// looks at finished-but-unpaid jobs, because that is where payment usually
// lands; every other verb needs a job that is still open.
async function findLeadsByName(verb: OperatorCommandVerb, name: string, includeTests: boolean): Promise<CommandLead[]> {
  const rows = (await getSql()`
    SELECT id, first_name, last_name, service, status, completed_at, paid_at
    FROM leads
    WHERE created_at > now() - interval '90 days'
      AND routed_to_lead_id IS NULL
      AND service <> 'Needs job match'
      AND (is_test = false OR ${includeTests}::boolean)
      AND (
        (${verb}::text = 'paid'
          AND status <> ALL(ARRAY['lost','spam']::text[])
          AND paid_at IS NULL)
        OR (${verb}::text <> 'paid'
          AND status <> ALL(ARRAY['won','lost','spam']::text[])
          AND completed_at IS NULL AND handed_off_at IS NULL)
      )
      AND (
        lower(btrim(regexp_replace(concat_ws(' ', first_name, last_name), '[[:space:]]+', ' ', 'g'))) = ${name}::text
        OR lower(btrim(first_name)) = ${name}::text
        OR lower(btrim(last_name)) = ${name}::text
      )
    ORDER BY created_at DESC, id DESC
    LIMIT 4`) as CommandLead[]
  return rows.map((row) => ({ ...row, id: Number(row.id) }))
}

function receiptKeyFor(sid: string) {
  return `sms-${sid.replace(/[^a-zA-Z0-9_-]/g, "")}`.slice(0, 80)
}

async function priorReply(sid: string): Promise<string | null> {
  const rows = (await getSql()`
    SELECT detail FROM events
    WHERE kind = ${OPERATOR_COMMAND_EVENT_KIND}::text AND external_id = ${sid}::text
    ORDER BY id ASC LIMIT 1`) as { detail: { reply?: string } | null }[]
  if (!rows[0]) return null
  return typeof rows[0].detail?.reply === "string" ? rows[0].detail.reply : ""
}

// Returns null when the text is not for this path (not a command, or not from
// an active operator), so the normal inbound flow runs untouched. Otherwise
// returns the plain-language reply that goes back to the sender only.
export async function handleOperatorText(input: {
  sid: string
  from: string
  body: string
  messageId: number
}): Promise<OperatorTextResult | null> {
  const parsed: ParsedOperatorCommand | null = parseOperatorCommand(input.body)
  if (!parsed) return null
  const operator = await operatorForPhone(input.from)
  if (!operator) return null

  // A signed replay of the same SID repeats the first answer and changes
  // nothing.
  const prior = await priorReply(input.sid)
  if (prior !== null) return { reply: prior }

  const finish = async (
    reply: string,
    outcome: "done" | "refused" | "unmatched" | "not-understood",
    leadId: number | null,
    verb: OperatorCommandVerb | null,
    amountCents?: number | null,
    tag?: { business: string; count: number | null },
  ) => {
    await journalOperatorCommand({ operator, sid: input.sid, body: input.body, messageId: input.messageId, verb, leadId, outcome, reply, amountCents, business: tag?.business, count: tag?.count })
    return { reply }
  }

  if (!parsed.ok) return finish(parsed.reply, "not-understood", null, parsed.verb)
  if (parsed.verb === "lost" && operator.role !== "owner") {
    return finish("Only the owner can mark a job lost.", "refused", null, "lost")
  }

  // Another business: no welding job to find. The tag rides the journal event
  // as the audit line. LD2R/Railing/BuilderBox counts also become roof_jobs
  // rows (O1); Grease Patrol stays audit-only, its jobs live in the Grease app.
  if (parsed.ref.kind === "business") {
    const { business, count } = parsed.ref
    if (isRoofJobBusiness(business)) {
      try {
        const rows = roofJobRowsForSmsCount({ business, verb: parsed.verb as "booked" | "paid", count, amountCents: parsed.amountCents, sid: input.sid })
        await recordSmsCountRoofJobs({ operator, business, rows })
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error"
        return finish(`Couldn't record ${business}: ${message}`.slice(0, 300), "refused", null, parsed.verb, parsed.amountCents, { business, count })
      }
    }
    return finish(businessReply(parsed.verb, business, { count, amountCents: parsed.amountCents }), "done", null, parsed.verb, parsed.amountCents, { business, count })
  }

  let lead: CommandLead | null = null
  let reason = parsed.reason
  if (parsed.ref.kind === "id") {
    lead = await findLeadById(parsed.ref.id)
    if (!lead) return finish(noMatchReply(`#${parsed.ref.id}`), "unmatched", null, parsed.verb)
  } else {
    const includeTests = canAccessInternalTests(operator.role)
    const label = parsed.ref.words.join(" ")
    let matches: CommandLead[] = []
    for (const reading of nameReadings(parsed.verb, parsed.ref.words)) {
      if (!reading.name) continue
      matches = await findLeadsByName(parsed.verb, reading.name, includeTests)
      if (matches.length) {
        reason = reading.reason
        break
      }
    }
    if (!matches.length) return finish(noMatchReply(label), "unmatched", null, parsed.verb)
    if (matches.length > 1) return finish(ambiguousReply(label, matches), "unmatched", null, parsed.verb)
    lead = matches[0]
  }

  const leadId = lead.id
  try {
    await requireLeadMutationAccess(operator, leadId)
    if (parsed.verb === "booked") {
      if (lead.completed_at) return finish(`#${leadId} ${candidateName(lead)} is already booked.`, "done", leadId, "booked")
      await completeLeadRecord(operator, leadId, new FormData())
    } else if (parsed.verb === "quoted") {
      await applyLeadStatus(operator, { leadId, status: "quoted", reason: "" })
    } else if (parsed.verb === "lost") {
      await applyLeadStatus(operator, { leadId, status: "lost", reason })
    } else {
      await recordPaymentRecord(operator, {
        leadId,
        amountCents: parsed.amountCents ?? 0,
        methodRaw: "other",
        settles: true,
        receiptKey: receiptKeyFor(input.sid),
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong."
    console.error("Operator text command failed:", error)
    return finish(`Couldn't do that for #${leadId}: ${message}`.slice(0, 300), "refused", leadId, parsed.verb, parsed.amountCents)
  }
  return finish(
    successReply(parsed.verb, lead, { amountCents: parsed.amountCents, reason }),
    "done",
    leadId,
    parsed.verb,
    parsed.amountCents,
  )
}
