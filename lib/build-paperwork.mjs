import { createHash } from "node:crypto"
import { createGateDxf } from "./call-sketch-dxf.mjs"
import { projectBuildDrawing } from "./build-sheets-continuation.mjs"

function hashContent(content) {
  return createHash("sha256").update(content).digest("hex")
}

function drawingSvg(drawing) {
  const margin = 18
  const viewWidth = 320
  const viewHeight = 260
  const availableWidth = viewWidth - margin * 2
  const availableHeight = 178
  const scale = Math.min(availableWidth / drawing.width, availableHeight / drawing.height)
  const width = drawing.width * scale
  const height = drawing.height * scale
  const left = (viewWidth - width) / 2
  const top = 38
  const stock = Math.max(3, drawing.stockSize * scale)
  const railGap = height / (drawing.railCount + 1)
  const rails = Array.from({ length: drawing.railCount }, (_, index) => {
    const y = top + railGap * (index + 1) - stock / 2
    return `<rect class="rail" x="${left + stock}" y="${y}" width="${Math.max(0, width - stock * 2)}" height="${stock}"/>`
  }).join("")
  const hingeX = drawing.hingeSide === "right" ? left + width : left
  const latchX = drawing.latchSide === "left" ? left : left + width
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewWidth} ${viewHeight}" role="img" aria-labelledby="title description">
  <title id="title">Locked gate elevation from Build Sheet ${drawing.sourceBuildSheetNumber}</title>
  <desc id="description">Finished gate ${drawing.width} inches wide by ${drawing.height} inches high, ${drawing.stockSize} inch stock, ${drawing.railCount} inside rails, hinges ${drawing.hingeSide}, latch ${drawing.latchSide}.</desc>
  <style>.frame,.rail{fill:none;stroke:#171a1d;stroke-width:2;vector-effect:non-scaling-stroke}.rail{fill:#d9dde1}.hardware{fill:#b34513}.dim{fill:#394047;font:14px sans-serif}.source{fill:#171a1d;font:600 14px sans-serif}</style>
  <text class="source" x="18" y="22">Build Sheet ${drawing.sourceBuildSheetNumber} · locked source</text>
  <rect class="frame" x="${left}" y="${top}" width="${width}" height="${height}"/>
  <rect class="frame" x="${left + stock}" y="${top + stock}" width="${Math.max(0, width - stock * 2)}" height="${Math.max(0, height - stock * 2)}"/>
  ${rails}
  <circle class="hardware" cx="${hingeX}" cy="${top + height * 0.3}" r="4"/><circle class="hardware" cx="${hingeX}" cy="${top + height * 0.7}" r="4"/>
  <rect class="hardware" x="${latchX - 3}" y="${top + height / 2 - 7}" width="6" height="14"/>
  <text class="dim" x="${viewWidth / 2}" y="${top + height + 22}" text-anchor="middle">${drawing.width} in finished width</text>
  <text class="dim" x="18" y="244">${drawing.height} in high · ${drawing.stockSize} in stock · ${drawing.railCount} rails</text>
</svg>`
}

export function compileBuildPaperwork({ kind, sheet } = {}) {
  const drawing = projectBuildDrawing(sheet)
  if (!drawing.fabricationReady && kind === "dxf") throw new Error("DXF stays blocked until every critical fact is shop-confirmed.")
  let content
  let contentType
  let extension
  if (kind === "drawing") {
    content = drawingSvg(drawing)
    contentType = "image/svg+xml; charset=utf-8"
    extension = "svg"
  } else if (kind === "dxf") {
    content = createGateDxf({
      width: drawing.width,
      height: drawing.height,
      stockSize: drawing.stockSize,
      railCount: drawing.railCount,
      hingeSide: drawing.hingeSide,
      latchSide: drawing.latchSide,
      title: `BUILD SHEET ${drawing.sourceBuildSheetNumber} - LOCKED GATE ELEVATION`,
    })
    contentType = "application/dxf; charset=utf-8"
    extension = "dxf"
  } else {
    throw new RangeError("Only a locked drawing or DXF can be compiled.")
  }
  return Object.freeze({
    kind,
    sourceBuildSheetNumber: drawing.sourceBuildSheetNumber,
    content,
    contentType,
    extension,
    contentHash: hashContent(content),
  })
}

export function paperworkIssueDecision(input = {}) {
  if (input.status !== "current") return { allowed: false, reason: "This paperwork is not current." }
  if (input.issueState !== "current") return { allowed: false, reason: "This paperwork is blocked." }
  if (Number(input.sourceBuildSheetNumber) !== Number(input.currentBuildSheetNumber)) {
    return { allowed: false, reason: "A newer locked Build Sheet exists." }
  }
  if (input.kind === "dxf" && input.fabricationReady !== true) {
    return { allowed: false, reason: "DXF stays blocked until critical facts are confirmed." }
  }
  return { allowed: true, reason: "" }
}
