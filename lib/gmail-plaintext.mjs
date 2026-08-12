const REPLY_TAILS = [
  /\n-{2,}\s*Original Message\s*-{2,}[\s\S]*$/i,
  /\nFrom:\s*[^\n]+\nSent:\s*[^\n]+\nTo:\s*[^\n]+\n(?:Cc:\s*[^\n]+\n)?Subject:\s*[^\n]+[\s\S]*$/i,
  /\nOn\s+(?=[\s\S]{0,500}(?:@|<|\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b))[\s\S]{0,500}?wrote:\s*[\s\S]*$/i,
  /\n_{5,}\s*\nFrom:\s*[^\n]+[\s\S]*$/i,
]

const HTML_ENTITIES = {
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "…",
  laquo: "«",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  nbsp: " ",
  quot: '"',
  raquo: "»",
  rdquo: "”",
  reg: "®",
  rsquo: "’",
  trade: "™",
}

function decodeHtmlEntities(input) {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (match, entity) => {
    const normalized = String(entity).toLowerCase()
    if (normalized.startsWith("#x")) {
      const value = Number.parseInt(normalized.slice(2), 16)
      return Number.isFinite(value) && value <= 0x10ffff ? String.fromCodePoint(value) : match
    }
    if (normalized.startsWith("#")) {
      const value = Number.parseInt(normalized.slice(1), 10)
      return Number.isFinite(value) && value <= 0x10ffff ? String.fromCodePoint(value) : match
    }
    return HTML_ENTITIES[normalized] ?? match
  })
}

export function readableEmailText(input = "") {
  let text = String(input).replace(/\r\n?/g, "\n")
  const looksLikeHtml = /<!doctype\s+html|<html\b|<body\b|<(?:a|br|div|p|table|tr|td|span|img)\b[^>]*>/i.test(text)
  if (looksLikeHtml) {
    text = text
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(?:head|style|script|svg|noscript)\b[^>]*>[\s\S]*?<\/(?:head|style|script|svg|noscript)>/gi, " ")
      .replace(/<blockquote\b[^>]*>[\s\S]*$/i, " ")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<\/(?:address|div|h[1-6]|li|p|table|tr)\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  }
  return decodeHtmlEntities(text)
    .normalize("NFKC")
    .replace(/[\u00ad\u034f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ +([,.;:!?])/g, "$1")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function stripQuotedReply(input = "") {
  let text = readableEmailText(input).replace(/\u00a0/g, " ")
  for (const marker of REPLY_TAILS) text = text.replace(marker, "")
  text = text
    .replace(/\nSent from my (?:iPhone|iPad|Android|mobile device)[\s\S]*$/i, "")
    .replace(/^>.*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
  return text.trim().slice(0, 30000)
}
