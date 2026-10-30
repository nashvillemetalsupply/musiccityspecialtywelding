/** Stable across sign-ins, separate across operators and permission changes. */
export function voiceOperatorScope(operator: { id: number; role: "owner" | "crew" }) {
  return `operator:${operator.id}:${operator.role}`
}
