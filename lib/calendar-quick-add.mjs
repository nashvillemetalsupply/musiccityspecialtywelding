export function calendarQuickAddIntakeKey(state, fallback) {
  if (state?.status === "saved") return state.nextIntakeKey
  if (state?.status === "partial" || state?.status === "error") return state.intakeKey || fallback
  return fallback
}
