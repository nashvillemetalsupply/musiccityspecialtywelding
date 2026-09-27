import sharp from "sharp"

const RASTER_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
])

export async function stripImageMetadata(input, contentType) {
  const normalizedType = String(contentType ?? "").toLowerCase().split(";", 1)[0].trim()
  if (!RASTER_IMAGE_TYPES.has(normalizedType)) throw new Error("Unsupported raster image type.")
  // Sharp removes EXIF and other metadata unless a keep/withMetadata method is
  // requested. rotate() applies the orientation before that metadata is gone.
  return sharp(Buffer.from(input), { animated: normalizedType === "image/gif", failOn: "error" })
    .rotate()
    .toBuffer()
}
