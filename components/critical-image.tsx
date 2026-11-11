import { getImageProps, type ImageProps } from "next/image"
import { preload } from "react-dom"
import provenance from "@/public/images/optimized/critical-image-provenance.json"

type CriticalImageProps = Pick<ImageProps, "src" | "alt" | "fill" | "sizes" | "quality" | "priority" | "fetchPriority"> & { src: string; fill: true; sizes: string }

// Reuse already-cached optimized bytes. Other widths retain Next's normal URL,
// and the native fallback keeps format negotiation for browsers without AVIF.
export function CriticalImage(image: CriticalImageProps) {
  const original = { ...image, priority: true, fetchPriority: "high" as const }
  const fallback = getImageProps(original).props
  const nextWidths = new Map<number, string>((fallback.srcSet ?? "").split(/,\s*/).map((candidate) => {
    const [url, descriptor] = candidate.trim().split(/\s+/)
    return [Number.parseInt(descriptor, 10), url]
  }))
  const avif = getImageProps({
    ...original,
    loader: ({ src, width, quality }) => provenance.assets.find((asset) =>
      asset.source === src && asset.width === width && asset.quality === (quality ?? 75),
    )?.publicPath ?? nextWidths.get(width) ?? fallback.src,
  }).props

  preload(avif.src, { as: "image", type: "image/avif", imageSrcSet: avif.srcSet, imageSizes: avif.sizes, fetchPriority: "high" })
  return <picture>
    <source type="image/avif" srcSet={avif.srcSet} sizes={avif.sizes} />
    {/* The fallback stays eager; picture selection prevents a duplicate fetch. */}
    <img {...fallback} alt={image.alt} />
  </picture>
}
