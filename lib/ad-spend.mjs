// Cost per lead: what the shop paid a channel this month divided by the leads
// that channel actually produced. Pure, so a test can hold it without a
// database, and so the same math serves a typed-in figure and a later API pull.

// Where the real numbers live, confirmed with the owner 2026-09-17, for
// whoever wires the API pull:
//   google   customer 747-818-3137, under manager 402-939-1001. MCSW-only,
//            so account-level spend is the answer.
//   facebook campaigns named LOCAL-WELDING-* inside ad account
//            191496172280537 (Nashville Metal Art). NOT the account named
//            "Music City Specialty Welding" (2312128719548799) -- that one
//            has never run a campaign. Account-level spend here would bill
//            MCSW for Nashville Metal Art's storefront ads, so the pull must
//            filter by campaign name prefix.
export const AD_CHANNELS = ["google", "facebook"]
export const AD_CHANNEL_LABELS = { google: "Google", facebook: "Facebook" }

const MAX_DOLLARS = 1_000_000

// Blank means "leave what is already saved alone" -- not zero. An owner who
// clears the box has not told the shop he spent nothing.
export function parseSpendDollars(raw) {
  const text = String(raw ?? "").trim()
  if (!text) return { ok: true, cents: null }
  const cleaned = text.replace(/[$,\s]/g, "")
  const dollars = Number(cleaned)
  if (!Number.isFinite(dollars) || dollars < 0 || dollars > MAX_DOLLARS) {
    return { ok: false, cents: null }
  }
  return { ok: true, cents: Math.round(dollars * 100) }
}

// No spend recorded is not the same answer as no leads. Spend with zero leads
// is a real number the owner needs to see, so it reports the whole spend as
// the cost of nothing rather than dividing by zero.
export function costPerLeadCents(spendCents, leads) {
  if (spendCents === null || spendCents === undefined) return null
  if (!Number.isFinite(spendCents) || spendCents < 0) return null
  if (!Number.isFinite(leads) || leads <= 0) return spendCents > 0 ? spendCents : null
  return Math.round(spendCents / leads)
}

// The body One Roof posts to /api/ops/ad-spend. Pure, for the same reason the
// rest of this file is: the endpoint itself is auth plus an upsert, and this is
// the part with branches worth holding in a test.
//
// month is optional and YYYY-MM. Omitted means "the Central month in progress",
// which is what a nightly push wants; naming it is how a backfill works without
// the server's clock deciding. Returned as YYYY-MM-01 or null.
export function parseAdSpendPayload(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "Body must be a JSON object." }

  const rawMonth = typeof body.month === "string" ? body.month.trim() : ""
  if (rawMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth)) {
    return { ok: false, error: "month must be YYYY-MM." }
  }

  const updates = []
  for (const channel of AD_CHANNELS) {
    const parsed = parseSpendDollars(body[channel])
    if (!parsed.ok) return { ok: false, error: `${channel} must be dollars, like 450 or 450.75.` }
    if (parsed.cents === null) continue
    updates.push({ channel, cents: parsed.cents })
  }
  // A push carrying no channel at all is a broken sender, not a no-op worth a
  // 200 -- it would look identical to a month of zero spend in the logs.
  if (updates.length === 0) return { ok: false, error: "No channel spend supplied." }

  return { ok: true, monthStart: rawMonth ? `${rawMonth}-01` : null, updates }
}
