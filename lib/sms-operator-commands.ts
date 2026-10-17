// Text-in commands for shop operators: "booked #12", "paid Smith $450",
// "quoted Smith", "lost #12 too expensive". Pure parsing and wording only, so
// the grammar is testable without a database. The database side lives in
// lib/sms-operator-in.ts.

export const OPERATOR_COMMAND_VERBS = ["booked", "paid", "quoted", "lost"] as const
export type OperatorCommandVerb = (typeof OPERATOR_COMMAND_VERBS)[number]

export const OPERATOR_COMMAND_EVENT_KIND = "sms.operator.in"

// Largest single payment a text may record. A fat-fingered extra zero should
// ask for a retry, not file a payment.
export const OPERATOR_PAYMENT_MAX_CENTS = 100_000_000

// Non-CRM service businesses an operator can report on by text (S81). Welding
// is the CRM itself and keeps the per-job commands.
export const BUSINESS_ALIASES: Record<string, string> = {
  "grease-patrol": "grease-patrol",
  grease: "grease-patrol",
  ld2r: "ld2r",
  railing: "railing",
  ridgeline: "railing",
  builderbox: "builderbox",
}

export type OperatorCommandRef =
  | { kind: "id"; id: number }
  | { kind: "business"; business: string; count: number | null }
  | { kind: "name"; words: string[] }

export type ParsedOperatorCommand =
  | {
      ok: true
      verb: OperatorCommandVerb
      ref: OperatorCommandRef
      amountCents: number | null
      // Only meaningful for `lost` with a #id: the words after the id.
      reason: string
    }
  | { ok: false; verb: OperatorCommandVerb; reply: string }

export const OPERATOR_COMMAND_HELP =
  "Texts I understand: booked #12, paid #12 $450, quoted #12, lost #12 reason. You can use a customer's name instead of the number."

// One line appended to the morning shop list so operators know what to text.
export const OPERATOR_TEXT_GRAMMAR =
  "\nText to update a job: booked #12 \u00b7 paid #12 $450 \u00b7 quoted #12 \u00b7 lost #12 reason \u00b7 other businesses: booked ld2r 2 \u00b7 paid ld2r $450"

const VERB_PATTERN = /^[\s"'“”]*(booked|paid|quoted|lost)\b[\s:,.\-–—]*(.*)$/is
const AMOUNT_PATTERN = /^\$(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/

function usage(verb: OperatorCommandVerb) {
  switch (verb) {
    case "booked":
      return "Booked needs a job. Text: booked #12"
    case "paid":
      return "Paid needs a job and an amount. Text: paid #12 $450"
    case "quoted":
      return "Quoted needs a job. Text: quoted #12"
    case "lost":
      return "Lost needs a job and a reason. Text: lost #12 too expensive"
  }
}

export function parseDollarsToken(token: string): number | null {
  const match = AMOUNT_PATTERN.exec(token.replace(/[.,;!]+$/, ""))
  if (!match) return null
  const dollars = Number(match[1].replace(/,/g, ""))
  const cents = Number((match[2] ?? "").padEnd(2, "0") || "0")
  const total = dollars * 100 + cents
  return Number.isSafeInteger(total) ? total : null
}

// Returns null when the text is not a command at all, so ordinary operator
// texts fall through to the normal inbound flow untouched.
export function parseOperatorCommand(body: string): ParsedOperatorCommand | null {
  const text = String(body ?? "").replace(/\s+/g, " ").trim()
  const match = VERB_PATTERN.exec(text)
  if (!match) return null
  const verb = match[1].toLowerCase() as OperatorCommandVerb
  const rest = match[2].trim()
  if (!rest) return { ok: false, verb, reply: usage(verb) }

  let amountCents: number | null = null
  let tokens = rest.split(" ")
  if (verb === "paid") {
    let index = -1
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      if (tokens[i].startsWith("$")) { index = i; break }
    }
    if (index < 0) return { ok: false, verb, reply: usage(verb) }
    const cents = parseDollarsToken(tokens[index])
    if (cents === null || cents <= 0) return { ok: false, verb, reply: "I couldn't read that amount. Text: paid #12 $450" }
    if (cents > OPERATOR_PAYMENT_MAX_CENTS) return { ok: false, verb, reply: "That amount looks too big for a text. Record it in the app." }
    amountCents = cents
    tokens = tokens.filter((_, i) => i !== index)
    if (!tokens.length) return { ok: false, verb, reply: usage(verb) }
  }

  const businessKey = tokens[0].toLowerCase().replace(/[.,;:!]+$/, "")
  if (verb === "booked" || verb === "paid") {
    if (businessKey === "welding") return { ok: false, verb, reply: "Welding jobs use the job number. Text: " + (verb === "booked" ? "booked #12" : "paid #12 $450") }
    const business = BUSINESS_ALIASES[businessKey]
    if (business) {
      if (verb === "paid") {
        if (tokens.length !== 1) return { ok: false, verb, reply: "Text: paid ld2r $450" }
        return { ok: true, verb, ref: { kind: "business", business, count: null }, amountCents, reason: "" }
      }
      const countMatch = tokens.length === 2 ? /^[0-9]{1,2}$/.exec(tokens[1]) : null
      const count = countMatch ? Number(countMatch[0]) : 0
      if (count < 1) return { ok: false, verb, reply: "Text how many jobs were booked. Text: booked ld2r 2" }
      return { ok: true, verb, ref: { kind: "business", business, count }, amountCents: null, reason: "" }
    }
  }

  const idMatch = /^#(\d{1,12})$/.exec(tokens[0])
  if (idMatch) {
    const id = Number(idMatch[1])
    if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, verb, reply: usage(verb) }
    const reason = tokens.slice(1).join(" ").trim().slice(0, 500)
    if (verb === "lost" && !reason) return { ok: false, verb, reply: usage(verb) }
    return { ok: true, verb, ref: { kind: "id", id }, amountCents, reason }
  }

  const words = tokens.filter(Boolean)
  if (!words.length) return { ok: false, verb, reply: usage(verb) }
  if (verb === "lost" && words.length < 2) return { ok: false, verb, reply: usage(verb) }
  return { ok: true, verb, ref: { kind: "name", words }, amountCents, reason: "" }
}

export function businessReply(verb: OperatorCommandVerb, business: string, extra: { count?: number | null; amountCents?: number | null }) {
  return verb === "booked"
    ? `Recorded ${business}: ${extra.count} booked.`
    : `Recorded ${business}: paid ${formatDollars(extra.amountCents ?? 0)}.`
}

export function normalizeNameKey(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim()
}

// Ways to read the words after the verb as "<name> [reason]". Only `lost`
// carries a reason, so it is the only verb with more than one reading, and the
// longest name that matches a real job wins (first and last name before first
// name alone).
export function nameReadings(verb: OperatorCommandVerb, words: string[]): { name: string; reason: string }[] {
  if (verb !== "lost") return [{ name: normalizeNameKey(words.join(" ")), reason: "" }]
  const readings: { name: string; reason: string }[] = []
  for (let k = Math.min(3, words.length - 1); k >= 1; k -= 1) {
    readings.push({ name: normalizeNameKey(words.slice(0, k).join(" ")), reason: words.slice(k).join(" ").slice(0, 500) })
  }
  return readings
}

export type CommandCandidate = { id: number; first_name: string; last_name: string; service: string }

export function candidateName(lead: { first_name: string; last_name: string }) {
  return [lead.first_name, lead.last_name].map((part) => String(part ?? "").trim()).filter(Boolean).join(" ") || "No name"
}

export function candidateLabel(lead: CommandCandidate) {
  const service = String(lead.service ?? "").trim()
  return `#${lead.id} ${candidateName(lead)}${service ? ` ${service}` : ""}`
}

export function formatDollars(cents: number) {
  const whole = Math.floor(cents / 100)
  const rest = cents % 100
  return `$${whole.toLocaleString("en-US")}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`
}

export function ambiguousReply(label: string, candidates: CommandCandidate[]) {
  const shown = candidates.slice(0, 3).map(candidateLabel).join("; ")
  return `More than one job matches "${label}". Nothing changed. Text the number instead: ${shown}`
}

export function noMatchReply(label: string) {
  return `No open job matches "${label}". Nothing changed. Text the job number, like: booked #12`
}

export function successReply(
  verb: OperatorCommandVerb,
  lead: { id: number; first_name: string; last_name: string },
  extra: { amountCents?: number | null; reason?: string } = {},
) {
  const who = `#${lead.id} ${candidateName(lead)}`
  switch (verb) {
    case "booked":
      return `Booked ${who}.`
    case "quoted":
      return `${who} is marked quoted.`
    case "paid":
      return `${who} paid in full${extra.amountCents ? `: ${formatDollars(extra.amountCents)}` : ""}.`
    case "lost":
      return `${who} is marked lost${extra.reason ? `: ${extra.reason}` : ""}.`
  }
}
