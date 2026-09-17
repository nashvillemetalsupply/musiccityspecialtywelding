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
