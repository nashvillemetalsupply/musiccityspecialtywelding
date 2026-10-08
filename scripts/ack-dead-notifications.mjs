// One-shot owner script: acknowledge the dead operator-alert backlog.
//
//   node scripts/ack-dead-notifications.mjs                       # dry run, counts only
//   node scripts/ack-dead-notifications.mjs --older-than-days 30  # dry run, other cutoff
//   node scripts/ack-dead-notifications.mjs --apply               # sets read_at
//
// Sets read_at on dead, unread, non-test notifications older than the cutoff
// (default 14 days). It never changes delivery_status, delivery_error, or any
// other column, never touches a test row, and prints counts only. Health stops
// counting a dead alert once it is read; the row and its history stay.
// Needs DATABASE_URL in the environment; it does not read .env files.

import { pathToFileURL } from "node:url"

const DEFAULT_OLDER_THAN_DAYS = 14

export function parseAckArgs(argv) {
  const options = { apply: false, olderThanDays: DEFAULT_OLDER_THAN_DAYS }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--apply") {
      options.apply = true
      continue
    }
    let value
    if (arg === "--older-than-days") {
      value = argv[index + 1]
      index += 1
    } else if (arg.startsWith("--older-than-days=")) {
      value = arg.slice("--older-than-days=".length)
    } else {
      throw new Error(`Unknown argument: ${arg}. Use --apply and --older-than-days N.`)
    }
    if (!/^\d+$/.test(String(value ?? "")) || Number(value) < 1 || !Number.isSafeInteger(Number(value))) {
      throw new Error("--older-than-days must be a positive whole number.")
    }
    options.olderThanDays = Number(value)
  }
  return options
}

export async function ackDeadNotifications({ sql, apply, olderThanDays }) {
  const [counted] = await sql`
    SELECT count(*)::int AS count
    FROM notifications n
    LEFT JOIN events e ON e.id = n.source_event_id
    LEFT JOIN leads l ON l.id = e.lead_id
    LEFT JOIN people p ON p.id = e.person_id
    WHERE n.delivery_status = 'dead' AND n.read_at IS NULL
      AND n.created_at < now() - ${olderThanDays}::int * interval '1 day'
      AND n.is_test = false
      AND COALESCE(l.is_test, false) = false
      AND COALESCE(p.is_test, false) = false
      AND lower(COALESCE(e.detail->>'isTest', 'false')) <> 'true'
      AND lower(COALESCE(n.action_detail->>'isTest', 'false')) <> 'true'
      AND n.title NOT ILIKE '%[INTERNAL TEST]%'
      AND n.body NOT ILIKE '%[INTERNAL TEST]%'`
  const matched = Number(counted?.count ?? 0)
  if (!apply) return { apply: false, olderThanDays, matched, updated: 0 }

  const [acked] = await sql`
    WITH acked AS (
      UPDATE notifications SET read_at = now()
      WHERE id IN (
        SELECT n.id
        FROM notifications n
        LEFT JOIN events e ON e.id = n.source_event_id
        LEFT JOIN leads l ON l.id = e.lead_id
        LEFT JOIN people p ON p.id = e.person_id
        WHERE n.delivery_status = 'dead' AND n.read_at IS NULL
          AND n.created_at < now() - ${olderThanDays}::int * interval '1 day'
          AND n.is_test = false
          AND COALESCE(l.is_test, false) = false
          AND COALESCE(p.is_test, false) = false
          AND lower(COALESCE(e.detail->>'isTest', 'false')) <> 'true'
          AND lower(COALESCE(n.action_detail->>'isTest', 'false')) <> 'true'
          AND n.title NOT ILIKE '%[INTERNAL TEST]%'
          AND n.body NOT ILIKE '%[INTERNAL TEST]%'
      )
      AND read_at IS NULL
      RETURNING id
    )
    SELECT count(*)::int AS count FROM acked`
  return { apply: true, olderThanDays, matched, updated: Number(acked?.count ?? 0) }
}

export function formatAckResult({ apply, olderThanDays, matched, updated }) {
  if (!apply) {
    return `Dry run: ${matched} dead unread non-test alert(s) older than ${olderThanDays} day(s). Re-run with --apply to mark them read.`
  }
  return `Marked ${updated} of ${matched} dead unread non-test alert(s) older than ${olderThanDays} day(s) as read.`
}

async function main() {
  const options = parseAckArgs(process.argv.slice(2))
  const url = process.env.DATABASE_URL?.trim()
  if (!url) throw new Error("DATABASE_URL is not set in the environment.")
  const { neon } = await import("@neondatabase/serverless")
  const result = await ackDeadNotifications({ sql: neon(url), ...options })
  console.log(formatAckResult(result))
}

// Importing the module (the test does) must never touch the database.
const invokedDirectly = Boolean(process.argv[1]) &&
  import.meta.url.toLowerCase() === pathToFileURL(process.argv[1]).href.toLowerCase()

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
