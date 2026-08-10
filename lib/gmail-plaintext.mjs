const REPLY_TAILS = [
  /\n-{2,}\s*Original Message\s*-{2,}[\s\S]*$/i,
  /\nFrom:\s*[^\n]+\nSent:\s*[^\n]+\nTo:\s*[^\n]+\n(?:Cc:\s*[^\n]+\n)?Subject:\s*[^\n]+[\s\S]*$/i,
  /\nOn\s+(?=[\s\S]{0,500}(?:@|<|\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b))[\s\S]{0,500}?wrote:\s*[\s\S]*$/i,
  /\n_{5,}\s*\nFrom:\s*[^\n]+[\s\S]*$/i,
]

export function stripQuotedReply(input = "") {
  let text = String(input).replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ")
  for (const marker of REPLY_TAILS) text = text.replace(marker, "")
  text = text
    .replace(/\nSent from my (?:iPhone|iPad|Android|mobile device)[\s\S]*$/i, "")
    .replace(/^>.*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
  return text.trim().slice(0, 30000)
}
