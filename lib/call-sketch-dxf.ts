const FRACTION_DENOMINATOR = 16

function greatestCommonDivisor(left, right) {
  let a = Math.abs(left)
  let b = Math.abs(right)
  while (b) {
    const next = a % b
    a = b
    b = next
  }
  return a || 1
}

/**
 * Format a decimal inch measurement as the shop would normally say it.
 * Values are rounded to the nearest 1/16 inch for display only.
 *
 * @param {number} value
 */
export function formatShopInches(value) {
  if (!Number.isFinite(value)) return "—"
  const negative = value < 0
  const totalSixteenths = Math.round(Math.abs(value) * FRACTION_DENOMINATOR)
  const whole = Math.floor(totalSixteenths / FRACTION_DENOMINATOR)
  const remainder = totalSixteenths % FRACTION_DENOMINATOR
  const sign = negative ? "-" : ""

  if (!remainder) return `${sign}${whole}\"`
  const divisor = greatestCommonDivisor(remainder, FRACTION_DENOMINATOR)
  const numerator = remainder / divisor
  const denominator = FRACTION_DENOMINATOR / divisor
  return `${sign}${whole ? `${whole} ` : ""}${numerator}/${denominator}\"`
}

function assertPositiveMeasurement(name, value) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive finite measurement.`)
  }
}

function number(value) {
  return Number(value.toFixed(4)).toString()
}

function addEntity(lines, kind, pairs) {
  lines.push("0", kind)
  for (const [code, value] of pairs) lines.push(String(code), String(value))
}

function addLine(lines, layer, x1, y1, x2, y2) {
  addEntity(lines, "LINE", [
    [8, layer],
    [10, number(x1)],
    [20, number(y1)],
    [30, "0"],
    [11, number(x2)],
    [21, number(y2)],
    [31, "0"],
  ])
}

function addCircle(lines, layer, x, y, radius) {
  addEntity(lines, "CIRCLE", [
    [8, layer],
    [10, number(x)],
    [20, number(y)],
    [30, "0"],
    [40, number(radius)],
  ])
}

function addText(lines, layer, x, y, height, value, rotation = 0) {
  addEntity(lines, "TEXT", [
    [8, layer],
    [10, number(x)],
    [20, number(y)],
    [30, "0"],
    [40, number(height)],
    [1, value],
    [50, number(rotation)],
  ])
}

function addRectangle(lines, layer, left, bottom, right, top) {
  addLine(lines, layer, left, bottom, right, bottom)
  addLine(lines, layer, right, bottom, right, top)
  addLine(lines, layer, right, top, left, top)
  addLine(lines, layer, left, top, left, bottom)
}

/**
 * Create a conservative ASCII DXF representation of the confirmed 2D gate.
 * It intentionally uses basic R12 entities so the file opens broadly across
 * CAD tools. Dimensions are ordinary geometry and labels, not associative CAD
 * dimensions, and the drawing remains marked as a concept sketch.
 *
 * @param {{
 *   kind?: "gate" | "frame",
 *   width: number,
 *   height: number,
 *   stockSize: number,
 *   railCount: number,
 *   hingeSide?: "left" | "right",
 *   latchSide?: "left" | "right",
 *   title?: string,
 * }} input
 */
export function createGateDxf(input) {
  const {
    kind = "gate",
    width,
    height,
    stockSize,
    railCount,
    hingeSide = "left",
    latchSide = "right",
    title = "CALL SKETCH - GATE ELEVATION",
  } = input

  if (!["gate", "frame"].includes(kind)) throw new RangeError("kind must be gate or frame.")

  assertPositiveMeasurement("width", width)
  assertPositiveMeasurement("height", height)
  assertPositiveMeasurement("stockSize", stockSize)
  if (stockSize * 2 >= Math.min(width, height)) {
    throw new RangeError("stockSize must leave a positive opening inside the frame.")
  }
  if (!Number.isInteger(railCount) || railCount < 0 || railCount > 8) {
    throw new RangeError("railCount must be an integer between 0 and 8.")
  }
  if (!["left", "right"].includes(hingeSide) || !["left", "right"].includes(latchSide)) {
    throw new RangeError("hingeSide and latchSide must be left or right.")
  }

  const lines = [
    "0", "SECTION", "2", "HEADER",
    "9", "$ACADVER", "1", "AC1009",
    "0", "ENDSEC",
    "0", "SECTION", "2", "TABLES", "0", "ENDSEC",
    "0", "SECTION", "2", "ENTITIES",
    "999", "CONCEPT SKETCH - VERIFY BEFORE FABRICATION",
  ]

  addRectangle(lines, "FRAME", 0, 0, width, height)
  addRectangle(lines, "FRAME", stockSize, stockSize, width - stockSize, height - stockSize)

  const railLeft = stockSize
  const railRight = width - stockSize
  for (let index = 1; index <= railCount; index += 1) {
    const center = (height * index) / (railCount + 1)
    const halfStock = stockSize / 2
    addRectangle(lines, "RAILS", railLeft, center - halfStock, railRight, center + halfStock)
  }

  if (kind === "gate") {
    const hingeX = hingeSide === "left" ? 0 : width
    const latchX = latchSide === "left" ? 0 : width
    const hardwareRadius = Math.max(stockSize / 3, 0.25)
    addCircle(lines, "HARDWARE", hingeX, height * 0.28, hardwareRadius)
    addCircle(lines, "HARDWARE", hingeX, height * 0.72, hardwareRadius)
    addRectangle(
      lines,
      "HARDWARE",
      latchX - hardwareRadius,
      height / 2 - stockSize / 2,
      latchX + hardwareRadius,
      height / 2 + stockSize / 2,
    )
  }

  const dimensionOffset = Math.max(5, stockSize * 2.5)
  const tick = Math.max(0.75, stockSize / 2)
  addLine(lines, "DIMENSIONS", 0, -dimensionOffset, width, -dimensionOffset)
  addLine(lines, "DIMENSIONS", 0, 0, 0, -dimensionOffset - tick)
  addLine(lines, "DIMENSIONS", width, 0, width, -dimensionOffset - tick)
  addLine(lines, "DIMENSIONS", 0, -dimensionOffset - tick, tick, -dimensionOffset + tick)
  addLine(lines, "DIMENSIONS", width - tick, -dimensionOffset - tick, width, -dimensionOffset + tick)
  addText(lines, "DIMENSIONS", width * 0.42, -dimensionOffset - 2.5, Math.max(1.2, stockSize * 0.7), formatShopInches(width))

  addLine(lines, "DIMENSIONS", -dimensionOffset, 0, -dimensionOffset, height)
  addLine(lines, "DIMENSIONS", 0, height, -dimensionOffset - tick, height)
  addLine(lines, "DIMENSIONS", 0, 0, -dimensionOffset - tick, 0)
  addLine(lines, "DIMENSIONS", -dimensionOffset - tick, 0, -dimensionOffset + tick, tick)
  addLine(lines, "DIMENSIONS", -dimensionOffset - tick, height, -dimensionOffset + tick, height - tick)
  addText(lines, "DIMENSIONS", -dimensionOffset - 2.5, height * 0.42, Math.max(1.2, stockSize * 0.7), formatShopInches(height), 90)

  addText(lines, "NOTES", 0, height + 4, Math.max(1.2, stockSize * 0.72), title.toUpperCase())
  addText(lines, "NOTES", 0, height + 1.5, Math.max(0.9, stockSize * 0.55), `${formatShopInches(stockSize)} SQUARE TUBE / ${railCount} INTERIOR RAILS`)
  addText(
    lines,
    "NOTES",
    0,
    -dimensionOffset - 6,
    Math.max(0.9, stockSize * 0.55),
    kind === "gate" ? `HINGES ${hingeSide.toUpperCase()} / LATCH ${latchSide.toUpperCase()}` : "RECTANGULAR FRAME / NO GATE HARDWARE",
  )

  lines.push("0", "ENDSEC", "0", "EOF")
  return `${lines.join("\r\n")}\r\n`
}
