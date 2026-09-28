export function escapeEmailText(value: unknown) : string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function safeEmailHref(value: unknown) : string {
  try {
    const parsed = new URL(String(value ?? "").trim())
    if (!["https:", "tel:", "mailto:"].includes(parsed.protocol)) return ""
    return escapeEmailText(parsed.toString())
  } catch {
    return ""
  }
}
