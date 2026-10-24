// Lead badges (Fable ruling 2026-10-24): one count per /board business tab of
// leads nobody has actioned yet. Welding counts its own leads table; LD2R,
// Grease Patrol and Railing form leads come from each site's bearer-gated
// /api/admin/leads feed into roof_leads; BuilderBox's feed has daily counts
// only, so its tab shows "N today" and has no rows. Feed rows carry hashes, no
// names or phone numbers, so no customer data reaches this table.
import { createHash } from "node:crypto"
import { getSql } from "./db.ts"
import type { Operator } from "@/lib/operators"

export const ROOF_LEAD_FEEDS = [
  { key: "LD2R", business: "ld2r", url: "https://www.ld2rcleaningservice.com/api/admin/leads" },
  { key: "GREASE", business: "grease-patrol", url: "https://musiccitygreasepatrol.com/api/admin/leads" },
  { key: "RAILING", business: "railing", url: "https://nashvilleornamental.com/api/admin/leads" },
] as const
export const BUILDERBOX_FEED_URL = "https://boxesforbuilders.com/api/admin/leads"
export const ROOF_LEAD_BUSINESSES: string[] = ROOF_LEAD_FEEDS.map((feed) => feed.business)
// Two days, not the feed's 90: a lead already handled before this shipped must
// not badge on day one. A lead stays in roof_leads once seen, so age never clears it.
export const FEED_WINDOW_DAYS = 2
export const FEED_SYNC_INTERVAL_MS = 5 * 60_000
const FEED_TIMEOUT_MS = 5_000

type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>
type Fetch = (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>
type Env = Record<string, string | undefined>

const sqlOrDefault = (sql?: Sql) => sql ?? (getSql() as unknown as Sql)

// Same rule as Mirror instruments/service-lead-floor.mjs hashPhone, so a job
// typed with the customer's phone matches the feed's phone_hash.
export function hashPhone(phone: unknown) {
  let digits = String(phone ?? "").replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1)
  return digits.length === 10 ? `sha256:${createHash("sha256").update(digits).digest("hex")}` : null
}

export type FeedLead = {
  lead_id: string
  received_at: string
  attribution: string | null
  phone_hash: string | null
  actioned_at: string | null
}

const isHash = (value: unknown) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value)

// Same skips as Mirror's leadsFromFeed: test leads and LD2R's unqualified leads
// never count. A lead the site already marked booked or lost is actioned.
export function parseFeedLeads(body: unknown): FeedLead[] {
  const leads = (body as { leads?: unknown })?.leads
  if (!Array.isArray(leads)) throw new Error("feed response had no leads array")
  const out: FeedLead[] = []
  for (const lead of leads) {
    if (lead?.lead_id == null || String(lead.lead_id) === "") continue
    if (lead.is_test === true || lead.qualified === false) continue
    const received = new Date(lead.created_at)
    if (Number.isNaN(received.getTime())) continue
    const statusAt = new Date(lead.status_at ?? lead.created_at)
    out.push({
      lead_id: String(lead.lead_id).slice(0, 120),
      received_at: received.toISOString(),
      attribution: lead.source == null ? null : String(lead.source).slice(0, 60),
      phone_hash: isHash(lead.phone_hash) ? lead.phone_hash : null,
      actioned_at: lead.status === "booked" || lead.status === "lost"
        ? (Number.isNaN(statusAt.getTime()) ? received : statusAt).toISOString()
        : null,
    })
  }
  return out
}

// BuilderBox counts feed: leads = quotes.total + applications.total for the
// America/Chicago day (same sum as Mirror feed-pull parseBuilderboxSite).
export function builderboxDayCount(body: unknown, day: string) {
  const row = ((body as { days?: { day: string; quotes?: { total?: number }; applications?: { total?: number } }[] })?.days ?? [])
    .find((entry) => entry.day === day)
  return row ? Number(row.quotes?.total ?? 0) + Number(row.applications?.total ?? 0) : 0
}

const chicagoDay = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(now)

async function readFeed(url: string, secret: string, fetchImpl: Fetch) {
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

// ponytail: per-instance throttle; each warm instance reads the feeds at most
// once per 5 minutes. Move to a shared timestamp row if instances multiply.
let lastSyncAt = 0
let builderboxToday: { day: string; count: number } | null = null

// Reads every configured feed (secret LEADS_FEED_SECRET_<KEY> in the Vercel env)
// and records new leads. A missing secret skips that site; a failing feed is
// logged and skipped. Never throws: the board must render without badges.
export async function syncLeadFeeds({ sql, fetchImpl = fetch as Fetch, env = process.env as Env, now = new Date(), force = false }: {
  sql?: Sql
  fetchImpl?: Fetch
  env?: Env
  now?: Date
  force?: boolean
} = {}) {
  if (!force && now.getTime() - lastSyncAt < FEED_SYNC_INTERVAL_MS) return
  lastSyncAt = now.getTime()
  await Promise.all([
    ...ROOF_LEAD_FEEDS.map(async (feed) => {
      const secret = env[`LEADS_FEED_SECRET_${feed.key}`]?.trim()
      if (!secret) return
      try {
        const leads = parseFeedLeads(await readFeed(`${feed.url}?days=${FEED_WINDOW_DAYS}`, secret, fetchImpl))
        for (const lead of leads) {
          await sqlOrDefault(sql)`
            INSERT INTO roof_leads (business, lead_id, received_at, source, attribution, phone_hash, contacted_at)
            VALUES (${feed.business}::text, ${lead.lead_id}::text, ${lead.received_at}::timestamptz, 'form',
              ${lead.attribution}::text, ${lead.phone_hash}::text, ${lead.actioned_at}::timestamptz)
            ON CONFLICT (business, lead_id) DO UPDATE
              SET contacted_at = COALESCE(roof_leads.contacted_at, EXCLUDED.contacted_at)`
        }
      } catch (error) {
        console.error(`Lead feed ${feed.key} skipped:`, error instanceof Error ? error.message : "unknown error")
      }
    }),
    (async () => {
      const secret = env.LEADS_FEED_SECRET_BUILDERBOX?.trim()
      if (!secret) return
      try {
        const day = chicagoDay(now)
        builderboxToday = { day, count: builderboxDayCount(await readFeed(`${BUILDERBOX_FEED_URL}?days=1`, secret, fetchImpl), day) }
      } catch (error) {
        console.error("Lead feed BUILDERBOX skipped:", error instanceof Error ? error.message : "unknown error")
      }
    })(),
  ])
}

export type LeadBadge = { count: number; title: string; today?: boolean }
export type LeadBadges = Record<string, LeadBadge>

const WELDING_CHANNELS: Record<string, string> = { "phone-in": "call", call: "call", "email-in": "email", "sms-in": "text" }

function badgeTitle(counts: Map<string, number>) {
  return [...counts].map(([channel, count]) => `${count} ${channel}${count === 1 ? "" : "s"}`).join(", ")
}

// Key "" is the welding board (MCSW Jobs). Zero-count businesses are absent.
// Welding and site badges fail separately (table not migrated yet, DB hiccup):
// a badge is never worth a broken board.
export async function leadBadgeCounts({ sql, now = new Date() }: { sql?: Sql; now?: Date } = {}): Promise<LeadBadges> {
  const badges: LeadBadges = {}
  try {
    // The same predicate getOpsStats uses for its new_leads count.
    const welding = await sqlOrDefault(sql)`
      SELECT source, count(*)::int AS count FROM leads
      WHERE status = 'new' AND is_test = false AND routed_to_lead_id IS NULL
      GROUP BY source` as { source: string; count: number }[]
    const channels = new Map<string, number>()
    for (const row of welding) {
      const channel = WELDING_CHANNELS[row.source] ?? "form"
      channels.set(channel, (channels.get(channel) ?? 0) + Number(row.count))
    }
    const total = [...channels.values()].reduce((sum, n) => sum + n, 0)
    if (total > 0) badges[""] = { count: total, title: badgeTitle(channels) }
  } catch (error) {
    console.error("Welding lead badge skipped:", error instanceof Error ? error.message : "unknown error")
  }
  try {
    const roof = await sqlOrDefault(sql)`
      SELECT business, source, count(*)::int AS count FROM roof_leads
      WHERE contacted_at IS NULL GROUP BY business, source` as { business: string; source: string; count: number }[]
    const byBusiness = new Map<string, Map<string, number>>()
    for (const row of roof) {
      const channels = byBusiness.get(row.business) ?? new Map<string, number>()
      channels.set(row.source, (channels.get(row.source) ?? 0) + Number(row.count))
      byBusiness.set(row.business, channels)
    }
    for (const [business, channels] of byBusiness) {
      badges[business] = { count: [...channels.values()].reduce((sum, n) => sum + n, 0), title: badgeTitle(channels) }
    }
  } catch (error) {
    console.error("Lead badges skipped:", error instanceof Error ? error.message : "unknown error")
  }
  if (builderboxToday && builderboxToday.day === chicagoDay(now) && builderboxToday.count > 0) {
    badges.builderbox = { count: builderboxToday.count, title: `${builderboxToday.count} quote or trade requests today`, today: true }
  }
  return badges
}

export type RoofLead = {
  id: number
  business: string
  source: string
  attribution: string | null
  received_at: string
}

export async function listOpenRoofLeads({ business, sql }: { business: string; sql?: Sql }): Promise<RoofLead[]> {
  if (!ROOF_LEAD_BUSINESSES.includes(business)) return []
  try {
    return await sqlOrDefault(sql)`
      SELECT id, business, source, attribution, received_at FROM roof_leads
      WHERE business = ${business}::text AND contacted_at IS NULL
      ORDER BY received_at DESC, id DESC LIMIT 50` as RoofLead[]
  } catch (error) {
    console.error("Open leads skipped:", error instanceof Error ? error.message : "unknown error")
    return []
  }
}

// Owner and crew both clear a lead: contacting a customer is not a money fact.
export async function markRoofLeadContacted({ operator, business, id, sql }: {
  operator: Pick<Operator, "id">
  business: string
  id: number
  sql?: Sql
}) {
  if (!ROOF_LEAD_BUSINESSES.includes(business)) throw new Error("Unknown business.")
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Refresh the business page and try again.")
  await sqlOrDefault(sql)`
    UPDATE roof_leads SET contacted_at = now(), contacted_by = ${operator.id}::bigint
    WHERE id = ${id}::bigint AND business = ${business}::text AND contacted_at IS NULL`
}

// A job booked with the lead's phone converts it: the lead leaves the count.
export async function closeRoofLeadsForPhone({ business, phone, operator, sql }: {
  business: string
  phone: string | null
  operator: Pick<Operator, "id">
  sql?: Sql
}) {
  const phoneHash = hashPhone(phone)
  if (!phoneHash || !ROOF_LEAD_BUSINESSES.includes(business)) return
  try {
    await sqlOrDefault(sql)`
      UPDATE roof_leads SET contacted_at = now(), contacted_by = ${operator.id}::bigint
      WHERE business = ${business}::text AND phone_hash = ${phoneHash}::text AND contacted_at IS NULL`
  } catch (error) {
    console.error("Lead conversion skipped:", error instanceof Error ? error.message : "unknown error")
  }
}
