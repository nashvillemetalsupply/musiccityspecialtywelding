// What is in the price, parsed from the one box the owner types it into.
//
// One line per item. Two shapes, both pipe-separated, because the grey
// qualifier beside a label is optional and forcing an empty middle field would
// be worse than reading the count:
//
//   Steel | 10 ga galv, 18 pcs | 1860
//   Galv touch-up | 180
//
// The parser is pure and lives here so a test can hold it without a database.

export const MAX_LINE_ITEMS = 40
const MAX_LABEL = 60
const MAX_NOTE = 80
const MAX_DOLLARS = 10_000_000

function parseAmount(raw) {
  const cleaned = raw.replace(/[$,\s]/g, "")
  if (!cleaned) return null
  const dollars = Number(cleaned)
  if (!Number.isFinite(dollars) || dollars < 0 || dollars > MAX_DOLLARS) return null
  return Math.round(dollars * 100)
}

// Returns every good line and every bad one. The caller decides whether a
// rejected line blocks the save -- it does -- but the owner gets told which
// line and why, not just "invalid".
export function parseLineItemsText(text) {
  const items = []
  const errors = []
  const lines = String(text ?? "").split(/\r?\n/)

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim()
    if (!line) continue
    const number = index + 1

    if (items.length >= MAX_LINE_ITEMS) {
      errors.push(`Line ${number}: more than ${MAX_LINE_ITEMS} lines. Nothing was saved.`)
      break
    }

    const parts = line.split("|").map((part) => part.trim())
    if (parts.length < 2 || parts.length > 3) {
      errors.push(`Line ${number}: needs "Label | amount" or "Label | note | amount".`)
      continue
    }

    const label = parts[0]
    const note = parts.length === 3 ? parts[1] : ""
    const amountCents = parseAmount(parts[parts.length - 1])

    if (!label) {
      errors.push(`Line ${number}: no label before the first "|".`)
      continue
    }
    if (amountCents === null) {
      errors.push(`Line ${number}: "${parts[parts.length - 1]}" is not a dollar amount.`)
      continue
    }

    items.push({
      label: label.slice(0, MAX_LABEL),
      note: note.slice(0, MAX_NOTE),
      amountCents,
    })
  }

  return { items, errors }
}

// The box the owner sees when the drawer opens, rebuilt from what is stored so
// editing is the same act as entering.
export function formatLineItemsText(items) {
  return (items ?? []).map((item) => {
    const dollars = (item.amountCents / 100).toLocaleString("en-US", {
      minimumFractionDigits: item.amountCents % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
      useGrouping: false,
    })
    return item.note ? `${item.label} | ${item.note} | ${dollars}` : `${item.label} | ${dollars}`
  }).join("\n")
}

export function lineItemsTotalCents(items) {
  return (items ?? []).reduce((total, item) => total + item.amountCents, 0)
}
