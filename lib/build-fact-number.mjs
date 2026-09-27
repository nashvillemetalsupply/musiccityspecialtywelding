const NUMERIC_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i

export function parseBuildFactNumber(raw, { label, integer = false, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY }) {
  let value
  if (typeof raw === "number") {
    value = raw
  } else if (typeof raw === "string") {
    const text = raw.trim()
    if (!text || !NUMERIC_TEXT.test(text)) throw new TypeError(`Enter a valid ${label}.`)
    value = Number(text)
  } else {
    throw new TypeError(`Enter a valid ${label}.`)
  }

  if (!Number.isFinite(value)) throw new TypeError(`Enter a valid ${label}.`)
  if (integer && !Number.isSafeInteger(value)) throw new TypeError(`Enter a valid ${label}.`)
  if (value < min || value > max) throw new TypeError(`Enter a valid ${label}.`)
  return value
}
