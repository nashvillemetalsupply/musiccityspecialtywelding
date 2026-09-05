import { Chivo, Golos_Text } from "next/font/google"

// The two faces the board reads in: Golos for everything read, Chivo for the
// numbers. Variable axes so the 420/500/640 ladder is real, not snapped to
// 400/700. adjustFontFallback sizes the system fallback to Golos's metrics so
// the page does not jump when the face arrives.
export const golos = Golos_Text({
  subsets: ["latin"],
  weight: "variable",
  variable: "--font-golos",
  display: "swap",
  adjustFontFallback: true,
})

export const chivo = Chivo({
  subsets: ["latin"],
  weight: "variable",
  variable: "--font-chivo",
  display: "swap",
  adjustFontFallback: true,
})
