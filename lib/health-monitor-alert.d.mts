export type HealthMonitorFailureAlert = {
  priority: "interrupt"
  stock: "red"
  title: string
  body: string
  url: string
  ownerOnly: true
  smsOnly: true
  quietHoursExempt: true
  isTest: boolean
  actionDetail: { source: "health-monitor"; runId: string; isTest: boolean }
  dedupeKey: string
}
export function buildHealthMonitorFailureAlert(runId: string, options?: { isTest?: boolean }, now?: Date): HealthMonitorFailureAlert | null
