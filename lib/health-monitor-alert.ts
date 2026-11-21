export type HealthMonitorFailureReason = "gmail-stale" | "consecutive-failures"

export type HealthMonitorFailureAlert = {
  priority: "interrupt"
  stock: "red"
  title: string
  body: string
  url: string
  ownerOnly: true
  smsOnly: true
  capExempt: true
  quietHoursExempt: true
  isTest: boolean
  actionDetail: { source: "health-monitor"; runId: string; isTest: boolean; reason?: HealthMonitorFailureReason }
  dedupeKey: string
}

export function buildHealthMonitorFailureAlert(runId: string, { isTest = false, reason }: { isTest?: boolean; reason?: HealthMonitorFailureReason } = {}, now: Date = new Date()) : HealthMonitorFailureAlert | null {
  const stableRunId = String(runId ?? "").trim()
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(stableRunId)) return null
  const timestamp = new Date(now)
  if (!Number.isFinite(timestamp.getTime())) return null

  const marker = isTest ? "[INTERNAL TEST] " : ""
  const bucket = `${timestamp.toISOString().slice(0, 10)}T${String(Math.floor(timestamp.getUTCHours() / 6) * 6).padStart(2, "0")}`
  const detail = reason === "gmail-stale"
    ? "Gmail has not synced successfully in over an hour."
    : "Two consecutive production health checks failed."
  return {
    priority: "interrupt",
    stock: "red",
    title: `${marker}Production health monitor failed`,
    body: `${marker}${detail} Recent delivery failures are listed on Updates.`,
    url: "/board/updates",
    ownerOnly: true,
    smsOnly: true,
    capExempt: true,
    quietHoursExempt: true,
    isTest,
    actionDetail: { source: "health-monitor", runId: stableRunId, isTest, reason },
    dedupeKey: `health-monitor:${isTest ? "test:" : ""}${bucket}`,
  }
}
