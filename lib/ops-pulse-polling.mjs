export const OPS_PULSE_ACTIVE_INTERVAL_MS = 10_000
export const OPS_PULSE_IDLE_INTERVAL_MS = 5 * 60_000
export const OPS_PULSE_REFRESH_MAX_INTERVAL_MS = 5 * 60_000
const IDLE_ACTIVITY_WINDOW_MS = 5 * 60_000

function pulseKey(pulse) {
  return JSON.stringify([
    pulse?.eventId ?? null,
    pulse?.eventsSignature ?? null,
    pulse?.callsUpdatedAt ?? null,
    pulse?.callsSignature ?? null,
    pulse?.callSketchesUpdatedAt ?? null,
    pulse?.callSketchesSignature ?? null,
    pulse?.callTranscriptSignature ?? null,
    pulse?.callDraftsSignature ?? null,
    pulse?.unreadNotifications ?? null,
    pulse?.notificationsSignature ?? null,
  ])
}

export function startOpsPulsePolling({
  onChange,
  fetchPulse = (url, options) => fetch(url, options),
  documentRef = document,
  windowRef = window,
  timers = globalThis,
  now = Date.now,
  idleActivityWindowMs = IDLE_ACTIVITY_WINDOW_MS,
} = {}) {
  let lastPulseKey = null
  let pendingChange = false
  let lastActivityAt = now()
  let lastRefreshAt = now()
  let timer = null
  let inFlight = false
  let checkPending = false
  let stopped = false

  const focused = () => typeof documentRef.hasFocus !== "function" || documentRef.hasFocus()
  const visible = () => documentRef.visibilityState === "visible"
  const active = () => visible() && (focused() || now() - lastActivityAt < idleActivityWindowMs)

  function schedule(delay = active() ? OPS_PULSE_ACTIVE_INTERVAL_MS : OPS_PULSE_IDLE_INTERVAL_MS) {
    if (timer !== null) {
      timers.clearTimeout(timer)
      timer = null
    }
    if (stopped || !visible()) return
    timer = timers.setTimeout(() => {
      timer = null
      if (inFlight) {
        refreshIfNeeded()
        schedule()
      } else {
        void poll()
      }
    }, delay)
  }

  function refreshIfNeeded() {
    if (!active()) return
    if (!pendingChange && now() - lastRefreshAt < OPS_PULSE_REFRESH_MAX_INTERVAL_MS) return
    pendingChange = false
    lastRefreshAt = now()
    onChange?.()
  }

  async function poll() {
    if (stopped || !visible()) return
    if (inFlight) {
      schedule()
      return
    }
    inFlight = true
    schedule()
    try {
      const response = await fetchPulse("/api/ops/pulse", { cache: "no-store" })
      if (!response?.ok) return
      const pulse = await response.json()
      const nextPulseKey = pulseKey(pulse)
      if (lastPulseKey !== null && nextPulseKey !== lastPulseKey) pendingChange = true
      lastPulseKey = nextPulseKey
    } catch {
      // A later poll retries; the board render remains usable while pulse is down.
    } finally {
      inFlight = false
      if (checkPending && visible() && !stopped) {
        checkPending = false
        refreshIfNeeded()
        void poll()
        return
      }
      checkPending = false
      refreshIfNeeded()
      schedule()
    }
  }

  function checkNow() {
    if (timer !== null) {
      timers.clearTimeout(timer)
      timer = null
    }
    if (!visible()) {
      checkPending = false
      return
    }
    if (inFlight) {
      checkPending = true
      return
    }
    void poll()
  }

  function onVisibilityChange() {
    if (visible()) lastActivityAt = now()
    checkNow()
  }

  function onFocus() {
    lastActivityAt = now()
    checkNow()
  }

  function onBlur() {
    schedule()
  }

  function onActivity() {
    const wasActive = active()
    lastActivityAt = now()
    if (!wasActive) checkNow()
    else schedule()
  }

  const activityEvents = ["pointerdown", "keydown", "touchstart"]
  documentRef.addEventListener("visibilitychange", onVisibilityChange)
  windowRef.addEventListener("focus", onFocus)
  windowRef.addEventListener("blur", onBlur)
  for (const event of activityEvents) documentRef.addEventListener(event, onActivity, { passive: true })
  void poll()

  return {
    checkNow,
    stop() {
      stopped = true
      if (timer !== null) timers.clearTimeout(timer)
      documentRef.removeEventListener("visibilitychange", onVisibilityChange)
      windowRef.removeEventListener("focus", onFocus)
      windowRef.removeEventListener("blur", onBlur)
      for (const event of activityEvents) documentRef.removeEventListener(event, onActivity)
    },
  }
}
