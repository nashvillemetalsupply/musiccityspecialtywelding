export type GlassMediaKind = "photo" | "attachment"
export const GLASS_MEDIA_URL_TTL_MS: number
export function createGlassMediaSignature(linkId: string, kind: GlassMediaKind, mediaId: string, expiresAt: number, secret?: string): string | null
export function verifyGlassMediaSignature(input: { linkId: string; kind: GlassMediaKind; mediaId: string; expiresAt: number | string; signature: string; now?: number; secret?: string }): boolean
export function createGlassMediaUrl(linkId: string, kind: GlassMediaKind, mediaId: string, options?: { now?: number; secret?: string }): string | null
export function stripImageMetadata(input: Uint8Array, contentType: string): Promise<Buffer>
