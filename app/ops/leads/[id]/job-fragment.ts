/** Keep a field's visible label with it when jumping into a closed drawer. */
export function jobFragmentScrollTarget(root: HTMLElement, target: HTMLElement): HTMLElement {
  // Cached route trees can contain the same field IDs. Native field.labels
  // resolves across the document, so find this job's label locally too.
  const label = Array.from(root.querySelectorAll<HTMLLabelElement>("label")).find((candidate) =>
    ((target.id && candidate.htmlFor === target.id) || candidate.contains(target))
    && candidate.getClientRects().length > 0
    && candidate.getBoundingClientRect().top <= target.getBoundingClientRect().top,
  )
  return label ?? target
}

/** Reveal a job's collapsed sections without changing unrelated disclosures. */
export function revealJobFragment(root: HTMLElement, fragment: string): HTMLElement | null {
  let id: string
  try {
    id = decodeURIComponent(fragment.replace(/^#/, ""))
  } catch {
    return null
  }
  if (!id) return null
  const targets = Array.from(root.querySelectorAll<HTMLElement>("[id], [data-job-fragment]"))
  const target = targets.find((candidate) => candidate.id === id)
    ?? targets.find((candidate) => candidate.dataset.jobFragment === id)
  if (!target) return null

  let element: HTMLElement | null = target
  while (element && element !== root) {
    if (element.tagName === "DETAILS") {
      (element as HTMLDetailsElement).open = true
    }
    element = element.parentElement
  }
  if (target.tagName === "FORM") {
    const field = Array.from(target.querySelectorAll<HTMLElement>("textarea:not([disabled]), input:not([disabled]):not([type='hidden']), select:not([disabled])"))
      .find((candidate) => candidate.getClientRects().length > 0)
    if (field) return field
  }
  return target
}
