/* Hand-built tattoo-flash SVG set. Stroke-only, currentColor, decorative. */
import type React from "react"

type FlashProps = {
  className?: string
  size?: number
  style?: React.CSSProperties
}

function frame(props: FlashProps, viewBox: string, children: React.ReactNode) {
  return (
    <svg
      className={props.className}
      style={props.style}
      width={props.size ?? 48}
      height={props.size ?? 48}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export function FlashBolt(props: FlashProps) {
  return frame(
    props,
    "0 0 48 48",
    <path d="M27 4 12 27h9l-4 17 19-25h-10l6-15z" />
  )
}

export function FlashSpark(props: FlashProps) {
  return frame(
    props,
    "0 0 48 48",
    <>
      <path d="M24 6v9M24 33v9M6 24h9M33 24h9" />
      <path d="M11 11l6 6M31 31l6 6M37 11l-6 6M17 31l-6 6" />
      <circle cx="24" cy="24" r="3.5" />
    </>
  )
}

export function FlashStar(props: FlashProps) {
  return frame(
    props,
    "0 0 48 48",
    <path d="M24 4l4.8 14.2L44 19l-12 9 4.6 14.6L24 33.4 11.4 42.6 16 28l-12-9 15.2-.8L24 4z" />
  )
}

export function FlashFlame(props: FlashProps) {
  return frame(
    props,
    "0 0 48 48",
    <>
      <path d="M24 44c-8 0-13-5.4-13-12.6 0-6.8 4.8-10.8 7.6-15.6C20.6 12.4 21 8.4 20 4c7 3 10.4 8.4 10.9 13.4 1.9-1.2 3-3.2 3.3-5.6C37.6 15.6 37 22 37 26c0 10-5 18-13 18z" />
      <path d="M24 44c-3.4 0-5.6-2.8-5.6-6.2 0-3.8 2.8-5.8 5.6-9.4 2.8 3.6 5.6 5.6 5.6 9.4 0 3.4-2.2 6.2-5.6 6.2z" />
    </>
  )
}

export function FlashTorch(props: FlashProps) {
  return frame(
    props,
    "0 0 48 48",
    <>
      <path d="M6 10l16 6M8 4l14 9" />
      <path d="M22 13l8 5-4 6-8-5z" />
      <path d="M28 22l4 3" />
      <path d="M34 27c3 1 6 4 7 8M35 22c4 0 8 2 10 5M31 31c1 3 0 7-2 9" />
    </>
  )
}

export function FlashGear(props: FlashProps) {
  return frame(
    props,
    "0 0 48 48",
    <>
      <circle cx="24" cy="24" r="7" />
      <path d="M24 3v7M24 38v7M3 24h7M38 24h7M9 9l5 5M34 34l5 5M39 9l-5 5M14 34l-5 5" />
    </>
  )
}

export function FlashHorseshoe(props: FlashProps) {
  return frame(
    props,
    "0 0 48 48",
    <>
      <path d="M12 42V22c0-8 5-14 12-14s12 6 12 14v20" />
      <path d="M8 42h9M31 42h9" />
      <path d="M12 28h4M32 28h4M12 20h4M32 20h4" />
    </>
  )
}

export function FlashBanner(props: FlashProps) {
  return frame(
    props,
    "0 0 64 32",
    <>
      <path d="M10 8h44l-6 8 6 8H10" />
      <path d="M10 8 4 4v20l6-4" />
    </>
  )
}
