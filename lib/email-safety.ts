export function escapeEmailText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function safeEmailHref(value) {
  try {
    const parsed = new URL(String(value ?? "").trim())
    if (!["https:", "tel:", "mailto:"].includes(parsed.protocol)) return ""
    return escapeEmailText(parsed.toString())
  } catch {
    return ""
  }
}
