const CONSUMER_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "icloud.com", "me.com", "outlook.com", "hotmail.com",
  "live.com", "msn.com", "yahoo.com", "aol.com", "proton.me", "protonmail.com",
])

export function normalizeCompanyKey(company: string) {
  return company.toLowerCase()
    .replace(/\b(?:incorporated|corporation|company|limited|inc|corp|llc|ltd|co)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
}

export function deriveAccountKey(input: { id?: number | null; company?: string | null; emails?: string[] | null }) {
  const domain = (input.emails ?? [])
    .map((email) => email.split("@")[1]?.toLowerCase())
    .find((item) => item && !CONSUMER_DOMAINS.has(item))
  if (domain) return `domain:${domain}`
  const company = normalizeCompanyKey(input.company ?? "")
  if (company) return `company:${company}`
  return input.id ? `person:${input.id}` : ""
}
