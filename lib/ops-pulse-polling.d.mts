export const OPS_PULSE_ACTIVE_INTERVAL_MS: number
export const OPS_PULSE_IDLE_INTERVAL_MS: number
export const OPS_PULSE_REFRESH_MAX_INTERVAL_MS: number

export function startOpsPulsePolling(input: {
  onChange?: () => void
  fetchPulse?: (url: string, options: { cache: "no-store" }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>
  documentRef?: Document
  windowRef?: Window
  timers?: Pick<typeof globalThis, "setTimeout" | "clearTimeout">
  now?: () => number
  idleActivityWindowMs?: number
}): { checkNow: () => void; stop: () => void }
