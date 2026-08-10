export const RASTER_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"])

export function isSafeRasterImage(contentType: string) {
  return RASTER_IMAGE_TYPES.has(contentType.toLowerCase().split(";", 1)[0].trim())
}
