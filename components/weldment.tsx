/* THE WELDMENT — hand-built SVG craft for the fabrication-drawing design system.
   Every piece is drawn for this shop; nothing comes from an icon set. */
import type React from "react"

type ArtProps = {
  className?: string
  style?: React.CSSProperties
}

/* A run of weld bead: overlapping crescent ripples like a stacked-dime MIG bead.
   Tiles horizontally; drawn once per 120px. */
export function WeldSeam({ id, className }: { id: string; className?: string }) {
  return (
    <div className={`wm-seam${className ? ` ${className}` : ""}`} aria-hidden="true">
      <svg className="wm-seam-svg" height="18" width="100%" focusable="false">
        <defs>
          <pattern id={id} patternUnits="userSpaceOnUse" width="120" height="18">
            <path
              d="M0 14 Q4 4 10 12 Q14 3 20 12 Q24 4 30 12 Q34 3 40 12 Q44 4 50 12 Q54 3 60 12 Q64 4 70 12 Q74 3 80 12 Q84 4 90 12 Q94 3 100 12 Q104 4 110 12 Q114 3 120 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
            <path
              d="M0 15.5 Q6 9 12 14.5 Q18 8 24 14.5 Q30 9 36 14.5 Q42 8 48 14.5 Q54 9 60 14.5 Q66 8 72 14.5 Q78 9 84 14.5 Q90 8 96 14.5 Q102 9 108 14.5 Q114 8 120 15.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.1"
              opacity="0.45"
            />
          </pattern>
        </defs>
        <rect width="100%" height="18" fill={`url(#${id})`} />
      </svg>
    </div>
  )
}

/* Engineering-drawing weld callout: leader line, arrow, flag, and a label. */
export function WeldCallout({
  label,
  note,
  className,
  style,
}: ArtProps & { label: string; note?: string }) {
  return (
    <div className={`wm-callout${className ? ` ${className}` : ""}`} style={style} aria-hidden="true">
      <svg viewBox="0 0 74 40" width="74" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" focusable="false">
        <path d="M2 38 L30 16 H72" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2 38 l8.5 -2.2 -4.6 -5.8 z" fill="currentColor" stroke="none" />
        <path d="M44 16 l7 -9 h9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M38 16 l5 6 5 -6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>
        {label}
        {note && <em>{note}</em>}
      </span>
    </div>
  )
}

/* Plate identity stamp for section corners. */
export function PlateStamp({ id, name, className }: { id: string; name: string; className?: string }) {
  return (
    <div className={`wm-stamp${className ? ` ${className}` : ""}`} aria-hidden="true">
      <span>{id}</span>
      <strong>{name}</strong>
    </div>
  )
}

/* The shop crest: welding helmet over crossed torches with a name banner. */
export function ShopCrest({ className, style }: ArtProps) {
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 120 120"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* crossed torches */}
      <path d="M22 96 L74 40 M74 40 l10 -8 M84 32 l7 5 -6 7 -7 -5 z M85 44 q9 7 10 19" />
      <path d="M98 96 L46 40 M46 40 l-10 -8 M36 32 l-7 5 6 7 7 -5 z M35 44 q-9 7 -10 19" />
      {/* helmet */}
      <path d="M38 66 q-3 -26 22 -27 q25 1 22 27 q1 16 -8 22 h-28 q-9 -6 -8 -22 z" fill="none" />
      <rect x="47" y="60" width="26" height="9" rx="1.5" />
      <path d="M60 39 v-7 M52 40 l-2 -6 M68 40 l2 -6" strokeWidth="2" />
      {/* banner */}
      <path d="M18 96 h84 l-6 9 h-72 z" />
      <path d="M18 96 l-8 -5 v14 l8 -4 M102 96 l8 -5 v14 l-8 -4" />
    </svg>
  )
}

/* Detailed cutting torch with coiled hose. */
export function Torch({ className, style }: ArtProps) {
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 140 90"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M10 72 q14 10 26 0 q12 -10 24 -2 q8 5 16 1" />
      <path d="M76 71 l16 -10 3 5 -16 10 z" />
      <path d="M92 62 l14 -9 M96 68 l14 -9" />
      <path d="M106 55 l9 -6 5 8 -9 6 z" />
      <path d="M118 52 l7 -4" strokeWidth="2" />
      <path d="M125 48 q6 -4 12 -3 M126 51 q5 0 9 3 M124 45 q3 -4 8 -6" strokeWidth="1.8" />
      <circle cx="86" cy="69" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

/* Spark burst with varied ray lengths — used at the hero kerf. */
export function SparkBurst({ className, style }: ArtProps) {
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 90 90"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M45 45 L45 12 M45 45 L69 21 M45 45 L80 45 M45 45 L66 66 M45 45 L45 76 M45 45 L26 64 M45 45 L14 45 M45 45 L27 27" opacity="0.9" />
      <path d="M45 45 L57 8 M45 45 L84 32 M45 45 L82 58 M45 45 L58 82 M45 45 L10 58 M45 45 L12 30" strokeWidth="1.4" opacity="0.55" />
      <circle cx="45" cy="45" r="3.4" fill="currentColor" stroke="none" />
    </svg>
  )
}

/* Chain links, hung from plate corners. */
export function ChainLinks({ className, style }: ArtProps) {
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 34 96"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="9" y="4" width="16" height="26" rx="8" />
      <rect x="9" y="26" width="16" height="26" rx="8" />
      <rect x="9" y="48" width="16" height="26" rx="8" />
      <path d="M17 74 v8 M13 86 h8" strokeLinecap="round" />
    </svg>
  )
}

/* Tennessee outline with a star on Lebanon. Simplified but recognizable. */
export function TennesseeMap({ className, style }: ArtProps) {
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 300 96"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 30 L292 12 L288 30 L272 34 L258 50 L240 58 L228 70 L212 74 L10 84 L14 62 L8 52 Z" />
      <path d="M158 40 l3.2 6.6 7.3 1 -5.3 5.1 1.3 7.2 -6.5 -3.4 -6.5 3.4 1.3 -7.2 -5.3 -5.1 7.3 -1 z" fill="currentColor" stroke="none" />
      <circle cx="158" cy="52" r="14" strokeWidth="1.4" strokeDasharray="3 4" />
    </svg>
  )
}

/* Corner gusset triangle for plate-framed media. */
export function Gusset({ className, style }: ArtProps) {
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 26 26"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M0 0 H26 L0 26 Z" fill="currentColor" />
      <circle cx="8" cy="8" r="2.4" fill="var(--mx-coal, #12100d)" />
    </svg>
  )
}
