import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import sharp from "sharp"
import test from "node:test"
import { stripImageMetadata } from "../lib/glass-media.ts"

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("served glass images are orientation-corrected and have EXIF removed", async () => {
  const gpsFixture = await sharp({
    create: { width: 2, height: 3, channels: 3, background: "red" },
  }).withExif({
    IFD0: { Artist: "[INTERNAL TEST] fixture" },
    GPS: { GPSLatitude: "36, 10.0N", GPSLongitude: "86, 47.0W" },
  }).jpeg().toBuffer()
  assert.ok((await sharp(gpsFixture).metadata()).exif, "fixture must contain EXIF before processing")

  const clean = await stripImageMetadata(gpsFixture, "image/jpeg")
  const metadata = await sharp(clean).metadata()
  assert.equal(metadata.exif, undefined, "GPS and other EXIF metadata must not leave the server")

  const unsupported = await assert.rejects(() => stripImageMetadata(Buffer.from("not an image"), "application/pdf"))
  assert.equal(unsupported, undefined)
})

test("glass photo and raster attachment responses pass through metadata stripping", () => {
  for (const route of ["app/api/glass/photo/route.ts", "app/api/glass/attachment/route.ts"]) {
    const code = source(route)
    assert.match(code, /stripImageMetadata/)
    assert.match(code, /new Response\((?:body|clean|responseBytes\.buffer)/)
    assert.match(code, /could not be processed safely/i)
  }
})
