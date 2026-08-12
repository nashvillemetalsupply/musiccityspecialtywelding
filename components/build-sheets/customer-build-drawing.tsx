import type { CustomerBuildDrawingProjection } from "@/lib/build-sheets-continuation.mjs"

export function CustomerBuildDrawing({ drawing }: { drawing: CustomerBuildDrawingProjection }) {
  const scale = Math.min(244 / drawing.width, 144 / drawing.height)
  const frameWidth = drawing.width * scale
  const frameHeight = drawing.height * scale
  const left = (280 - frameWidth) / 2
  const top = 32
  const stock = Math.max(4, drawing.stockSize * scale)
  const hingeX = drawing.hingeSide === "right" ? left + frameWidth : left
  const latchX = drawing.latchSide === "left" ? left : left + frameWidth

  return <figure className="glass-build-drawing">
    <svg viewBox="0 0 280 224" role="img" aria-labelledby="customer-build-drawing-title customer-build-drawing-description">
      <title id="customer-build-drawing-title">Shared gate drawing from Build Sheet {drawing.sourceBuildSheetNumber}</title>
      <desc id="customer-build-drawing-description">Finished gate {drawing.width} inches wide by {drawing.height} inches high, with {drawing.railCount} inside rails. Hinges are on the {drawing.hingeSide}; latch is on the {drawing.latchSide}.</desc>
      <text className="glass-build-drawing-source" x="18" y="20">Build Sheet {drawing.sourceBuildSheetNumber}</text>
      <rect className="glass-build-drawing-frame" x={left} y={top} width={frameWidth} height={frameHeight} />
      <rect className="glass-build-drawing-frame" x={left + stock} y={top + stock} width={Math.max(0, frameWidth - stock * 2)} height={Math.max(0, frameHeight - stock * 2)} />
      {Array.from({ length: drawing.railCount }, (_, index) => {
        const center = top + (frameHeight * (index + 1)) / (drawing.railCount + 1)
        return <rect className="glass-build-drawing-rail" key={index} x={left + stock} y={center - stock / 2} width={Math.max(0, frameWidth - stock * 2)} height={stock} />
      })}
      <circle className="glass-build-drawing-hardware" cx={hingeX} cy={top + frameHeight * 0.3} r="4" />
      <circle className="glass-build-drawing-hardware" cx={hingeX} cy={top + frameHeight * 0.7} r="4" />
      <rect className="glass-build-drawing-hardware" x={latchX - 3} y={top + frameHeight / 2 - 7} width="6" height="14" />
      <line className="glass-build-drawing-dimension" x1={left} x2={left + frameWidth} y1={top + frameHeight + 14} y2={top + frameHeight + 14} />
      <text className="glass-build-drawing-label" x="140" y={top + frameHeight + 32} textAnchor="middle">{drawing.width} in finished width</text>
      <text className="glass-build-drawing-label" x="18" y="216">{drawing.height} in high · {drawing.railCount} rails</text>
    </svg>
    <figcaption>Shared drawing · Build Sheet {drawing.sourceBuildSheetNumber}</figcaption>
  </figure>
}
