export class VoiceIdentityUnavailableError extends Error {}

/** An authenticated identity may capture offline only within this mounted page. */
export function offlineRecordingScope(error: unknown, lastVerifiedScope: string) {
  return !(error instanceof VoiceIdentityUnavailableError) && /^operator:[1-9][0-9]*:(owner|crew)$/.test(lastVerifiedScope)
    ? lastVerifiedScope : null
}

export function scopedVoiceStorageKey(scope: string, recoveryKey: string) {
  return `mcsw-voice:${scope}:${recoveryKey.replace(/[^a-z0-9:_-]/gi, "-")}`
}

export function voiceIntentMatchesScope(intent: { scope?: string } | null | undefined, scope: string) {
  return Boolean(scope && intent?.scope === scope)
}

export async function readCurrentVoiceScope(request: typeof fetch = fetch): Promise<string> {
  const response = await request("/api/ops/cache-session", { cache: "no-store" })
  if (response.status === 401 || response.status === 403) throw new VoiceIdentityUnavailableError("Sign in before using voice. Saved notes remain on this device.")
  if (!response.ok) throw new Error("Reconnect before using voice. Saved notes remain on this device.")
  const data = await response.json() as { voiceScope?: string }
  if (!data.voiceScope || !/^operator:[1-9][0-9]*:(owner|crew)$/.test(data.voiceScope)) {
    throw new VoiceIdentityUnavailableError("Your voice identity could not be checked. Saved notes remain on this device.")
  }
  return data.voiceScope
}
