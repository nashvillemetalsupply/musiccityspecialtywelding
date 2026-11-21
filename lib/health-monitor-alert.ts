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

export function buildHealthMonitorFailureAlert(runId: string, { episodeId, isTest = false, reason }: { episodeId: string; isTest?: boolean; reason?: HealthMonitorFailureReason }): HealthMonitorFailureAlert | null {
  const stableRunId = String(runId ?? "").trim()
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(stableRunId)) return null

  const marker = isTest ? "[INTERNAL TEST] " : ""
  const detail = reason === "gmail-stale"
    ? "Gmail has not synced successfully in over an hour."
    : "Production health checks have been failing for at least 30 minutes."
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
    dedupeKey: `health-monitor:${isTest ? "test:" : ""}${episodeId}`,
  }
}
