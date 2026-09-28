type QuickAddKeyState =
  | { status: "idle" }
  | { status: "saved"; nextIntakeKey: string }
  | { status: "partial" | "error"; intakeKey: string }

export function calendarQuickAddIntakeKey(state: QuickAddKeyState, fallback: string) : string {
  if (state?.status === "saved") return state.nextIntakeKey
  if (state?.status === "partial" || state?.status === "error") return state.intakeKey || fallback
  return fallback
}
