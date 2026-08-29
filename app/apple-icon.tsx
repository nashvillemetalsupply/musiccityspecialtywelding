import { ImageResponse } from "next/og"

export const size = { width: 180, height: 180 }
export const contentType = "image/png"

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#0f0f0d",
          border: "8px solid #f36f21",
          color: "#f3eee3",
          display: "flex",
          flexDirection: "column",
          fontFamily: "Arial Black, Arial, sans-serif",
          height: "100%",
          justifyContent: "center",
          letterSpacing: "-0.08em",
          width: "100%",
        }}
      >
        <div style={{ display: "flex", fontSize: 66, fontWeight: 900, lineHeight: 0.9 }}>MCS</div>
        <div
          style={{
            background: "#f36f21",
            color: "#0f0f0d",
            display: "flex",
            fontSize: 22,
            fontWeight: 900,
            letterSpacing: "0.08em",
            marginTop: 14,
            padding: "5px 10px",
          }}
        >
          WELDING
        </div>
      </div>
    ),
    size,
  )
}
