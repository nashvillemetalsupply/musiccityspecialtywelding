export type VoiceCount = { text: string; count: number; sources: number }

export type VoiceProfile = {
  speaker: string
  displayName: string
  sourceCount: number
  lineCount: number
  wordCount: number
  wordsPerLine: number
  questionRate: number
  contractionRate: number
  openers: VoiceCount[]
  closers: VoiceCount[]
  phrases: VoiceCount[]
  tics: VoiceCount[]
  vocabulary: VoiceCount[]
  samples: string[]
}

// One line he said or wrote, and which call, note or paste it came from.
export type VoiceLine = { sourceRef: string; text: string }

export function normalizeLine(text: string | null | undefined): string
export function emptyVoiceProfile(): VoiceProfile
export function deriveVoiceProfile(
  lines: VoiceLine[] | null | undefined,
  options?: { displayName?: string },
): VoiceProfile
export function voiceProfileIsUsable(profile: VoiceProfile | null | undefined): boolean
export function voiceStyleGuide(profile: VoiceProfile | null | undefined): string
