type QuickAddKeyState =
  | { status: "idle" }
  | { status: "saved"; nextIntakeKey: string }
  | { status: "partial" | "error"; intakeKey: string }

export function calendarQuickAddIntakeKey(state: QuickAddKeyState, fallback: string): string
