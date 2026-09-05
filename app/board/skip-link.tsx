// First focusable element on each shell; the target accepts focus in Safari too.
export function SkipLink({ label = "Skip to content" }: { label?: string }) {
  return <a className="skip" href="#main">{label}</a>
}
