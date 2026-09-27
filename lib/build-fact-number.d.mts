export interface BuildFactNumberOptions {
  label: string
  integer?: boolean
  min?: number
  max?: number
}

export function parseBuildFactNumber(
  raw: FormDataEntryValue | number | null,
  options: BuildFactNumberOptions,
): number
