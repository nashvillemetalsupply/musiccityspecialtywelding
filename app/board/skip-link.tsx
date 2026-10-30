"use client"

// Keep native fragment navigation unless a retained hidden route owns the ID.
export function SkipLink({ label = "Skip to content" }: { label?: string }) {
  return <a className="skip" href="#main" onClick={(event) => {
    const document = event.currentTarget.ownerDocument
    const target = Array.from(document.querySelectorAll<HTMLElement>("[id='main']")).find(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden")
    if (!target || document.getElementById("main") === target) return
    event.preventDefault()
    target.scrollIntoView({ block: "start" })
    target.focus({ preventScroll: true })
  }}>{label}</a>
}
