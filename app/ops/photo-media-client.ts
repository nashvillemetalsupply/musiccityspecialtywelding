export function scaledPhotoDimensions(width: number, height: number, maxEdge = 1600) {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** Keep the original separately in the outbox. Unsupported formats remain intact. */
export async function prepareCloseoutImage(original: Blob, originalName: string) {
  const unchanged = { file: original, filename: originalName, contentType: original.type }
  if (!/^image\/(jpeg|png|webp)$/i.test(original.type)) return unchanged
  let image: ImageBitmap | HTMLImageElement | null = null
  let objectUrl = ""
  try {
    if (typeof createImageBitmap === "function") image = await createImageBitmap(original)
    else {
      objectUrl = URL.createObjectURL(original)
      const element = new Image()
      element.src = objectUrl
      await element.decode()
      image = element
    }
    const { width, height } = scaledPhotoDimensions(image.width, image.height)
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext("2d")
    if (!context) return unchanged
    context.drawImage(image, 0, 0, width, height)
    const encode = (type: string) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, 0.78))
    const candidates = (await Promise.all([encode("image/jpeg"), encode("image/webp")])).filter((file): file is Blob => Boolean(file?.size))
    const smallest = candidates.sort((a, b) => a.size - b.size)[0]
    if (!smallest || smallest.size >= original.size) return unchanged
    const extension = smallest.type === "image/webp" ? "webp" : "jpg"
    return { file: smallest, filename: `${originalName.replace(/\.[^.]+$/, "") || "closeout-image"}.${extension}`, contentType: smallest.type }
  } catch {
    // A browser that cannot decode HEIC or another image still keeps its bytes.
    return unchanged
  } finally {
    if (image && "close" in image) image.close()
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}
