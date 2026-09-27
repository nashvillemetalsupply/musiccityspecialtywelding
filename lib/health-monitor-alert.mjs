export function buildHealthMonitorFailureAlert(runId, { isTest = false } = {}) {
  const stableRunId = String(runId ?? "").trim()
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(stableRunId)) return null

  const marker = isTest ? "[INTERNAL TEST] " : ""
  return {
    priority: "interrupt",
    stock: "red",
    title: `${marker}Production health monitor failed`,
    body: `${marker}Open the Health Monitor run for details. Recent delivery failures are listed on Updates.`,
    url: "/board/updates",
    ownerOnly: true,
    smsOnly: true,
    quietHoursExempt: true,
    isTest,
    actionDetail: { source: "health-monitor", runId: stableRunId, isTest },
    dedupeKey: `health-monitor:${isTest ? "test:" : ""}${stableRunId}`,
  }
}
