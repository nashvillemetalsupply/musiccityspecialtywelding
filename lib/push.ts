import webpush from "web-push"
import { getSql } from "@/lib/db"

export function pushConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim()
  )
}

function configureWebPush() {
  webpush.setVapidDetails(
    "mailto:sales@musiccityspecialtywelding.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!.trim(),
    process.env.VAPID_PRIVATE_KEY!.trim()
  )
}

export async function saveSubscription(subscription: {
  endpoint: string
  keys: { p256dh: string; auth: string }
}, operatorId?: number | null) {
  const sql = getSql()
  await sql`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth, operator_id)
    VALUES (
      ${subscription.endpoint}::text,
      ${subscription.keys.p256dh}::text,
      ${subscription.keys.auth}::text,
      ${operatorId ?? null}::bigint
    )
    ON CONFLICT (endpoint) DO UPDATE SET
      p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
      operator_id = EXCLUDED.operator_id`
}

export async function removeSubscription(endpoint: string) {
  const sql = getSql()
  await sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}::text`
}

// Second alert channel alongside email. Never throws; prunes dead endpoints.
async function sendPush(payload: { title: string; body: string; url: string }, operatorId?: number | null) {
  if (!pushConfigured()) return { sent: 0 }
  try {
    configureWebPush()
    const sql = getSql()
    const subs = (await sql`
      SELECT endpoint, p256dh, auth FROM push_subscriptions
      WHERE (${operatorId ?? null}::bigint IS NULL OR operator_id = ${operatorId ?? null}::bigint)
      LIMIT 50`) as {
      endpoint: string
      p256dh: string
      auth: string
    }[]
    let sent = 0
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          { TTL: 3600 }
        )
        sent += 1
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode
        if (statusCode === 404 || statusCode === 410) {
          await removeSubscription(sub.endpoint).catch(() => undefined)
        } else {
          console.error("Push send error:", error)
        }
      }
    }
    return { sent }
  } catch (error) {
    console.error("Push fan-out error:", error)
    return { sent: 0 }
  }
}

export async function sendPushToAll(payload: { title: string; body: string; url: string }) {
  return sendPush(payload)
}

export async function sendPushToOperator(
  operatorId: number,
  payload: { title: string; body: string; url: string }
) {
  return sendPush(payload, operatorId)
}
