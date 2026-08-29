type PublicSkipLinkProps = {
  label?: string
}

export function PublicSkipLink({ label = "Skip to main content" }: PublicSkipLinkProps) {
  return (
    <a className="ms-skip" href="#main-content">
      {label}
    </a>
  )
}
