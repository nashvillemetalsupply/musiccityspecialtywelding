import type { BuildDrawingProjection } from "@/lib/build-sheets-continuation.mjs"

function scaledGeometry(drawing: BuildDrawingProjection) {
  const width = 284
  const availableHeight = 190
  const scale = Math.min(width / drawing.width, availableHeight / drawing.height)
  const renderedWidth = drawing.width * scale
  const renderedHeight = drawing.height * scale
  return {
    left: (320 - renderedWidth) / 2,
    top: 34,
    width: renderedWidth,
    height: renderedHeight,
    stock: Math.max(4, drawing.stockSize * scale),
  }
}

export function BuildSheetDrawing({ drawing }: { drawing: BuildDrawingProjection }) {
  const geometry = scaledGeometry(drawing)
  const hingeX = drawing.hingeSide === "right" ? geometry.left + geometry.width : geometry.left
  const latchX = drawing.latchSide === "left" ? geometry.left : geometry.left + geometry.width
  const rails = Array.from({ length: drawing.railCount }, (_, index) => {
    const center = geometry.top + (geometry.height * (index + 1)) / (drawing.railCount + 1)
    return <rect className="ops-builds-drawing-rail" key={index} x={geometry.left + geometry.stock} y={center - geometry.stock / 2} width={Math.max(0, geometry.width - geometry.stock * 2)} height={geometry.stock} />
  })

  return <figure className="ops-builds-drawing">
    <svg viewBox="0 0 320 282" role="img" aria-labelledby="build-drawing-title build-drawing-description">
      <title id="build-drawing-title">{`Gate elevation from Build Sheet ${drawing.sourceBuildSheetNumber}`}</title>
      <desc id="build-drawing-description">{`Finished gate ${drawing.width} inches wide by ${drawing.height} inches high, with ${drawing.railCount} inside rails. Hinges are on the ${drawing.hingeSide}; latch is on the ${drawing.latchSide}.`}</desc>
      <text className="ops-builds-drawing-source" x="18" y="20">{`Locked Build Sheet ${drawing.sourceBuildSheetNumber}`}</text>
      <rect className="ops-builds-drawing-frame" x={geometry.left} y={geometry.top} width={geometry.width} height={geometry.height} />
      <rect className="ops-builds-drawing-frame" x={geometry.left + geometry.stock} y={geometry.top + geometry.stock} width={Math.max(0, geometry.width - geometry.stock * 2)} height={Math.max(0, geometry.height - geometry.stock * 2)} />
      {rails}
      <circle className="ops-builds-drawing-hardware" cx={hingeX} cy={geometry.top + geometry.height * 0.3} r="4" />
      <circle className="ops-builds-drawing-hardware" cx={hingeX} cy={geometry.top + geometry.height * 0.7} r="4" />
      <rect className="ops-builds-drawing-hardware" x={latchX - 3} y={geometry.top + geometry.height / 2 - 7} width="6" height="14" />
      <line className="ops-builds-drawing-dimension" x1={geometry.left} x2={geometry.left + geometry.width} y1={geometry.top + geometry.height + 17} y2={geometry.top + geometry.height + 17} />
      <text className="ops-builds-drawing-label" x="160" y={geometry.top + geometry.height + 35} textAnchor="middle">{drawing.width} in finished width</text>
      <text className="ops-builds-drawing-label" x="18" y="273">{drawing.height} in high · {drawing.stockSize} in stock · {drawing.railCount} rails</text>
    </svg>
    <figcaption>{drawing.fabricationReady ? "Locked geometry · fabrication outputs allowed" : "Preview only · fabrication stays blocked"}</figcaption>
  </figure>
}
