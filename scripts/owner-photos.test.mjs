import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"
import sharp from "sharp"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url))
const provenance = JSON.parse(read("public/images/owner-work/owner-photo-provenance-2026-11-11.json"))
// Each replacement stays within the source-byte ceiling of its previous slot.
// The smaller existing home planter photo remains in use.
const previousBytes = new Map([
  ["/images/owner-work/black-metal-mailbox.webp", 288022],
  ["/images/owner-work/welded-aluminum-housing.webp", 105196],
  ["/images/owner-work/trailer-tongue-and-coupler.webp", 643214],
  ["/images/owner-work/finished-steel-gate.webp", 302358],
  ["/images/owner-work/porch-ring-railing.webp", 108252],
])

function webpChunks(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF")
  assert.equal(bytes.toString("ascii", 8, 12), "WEBP")
  assert.equal(bytes.readUInt32LE(4) + 8, bytes.length, "WebP must have no trailing metadata")
  const chunks = []
  let offset = 12
  while (offset < bytes.length) {
    assert.ok(offset + 8 <= bytes.length, "each WebP chunk needs a complete header")
    const size = bytes.readUInt32LE(offset + 4)
    chunks.push(bytes.toString("ascii", offset, offset + 4))
    offset += 8 + size + (size % 2)
    assert.ok(offset <= bytes.length, "WebP chunk must fit inside the file")
  }
  assert.equal(offset, bytes.length)
  return chunks
}

test("owner photos retain provenance, slot crops and the prior image byte budgets", async () => {
  assert.equal(provenance.date, "2026-11-11")
  assert.deepEqual(provenance.assets.map((asset) => asset.publicPath).sort(), [...previousBytes.keys()].sort())
  const publicCode = `${read("lib/service-pages.ts")}\n${read("app/page.tsx")}`
  for (const asset of provenance.assets) {
    assert.match(asset.source, /^[^/\\]+\.(?:jpe?g|png|heic)$/i, "original provenance records only a photo basename")
    assert.match(asset.sourceSha256, /^[a-f0-9]{64}$/, "the gitignored original still needs its SHA-256")
    assert.match(asset.sha256, /^[a-f0-9]{64}$/)
    const output = read(`public${asset.publicPath}`)
    assert.equal(createHash("sha256").update(output).digest("hex"), asset.sha256, asset.publicPath)
    assert.equal(output.length, asset.bytes, asset.publicPath)
    assert.equal(asset.previousBytes, previousBytes.get(asset.publicPath))
    assert.ok(output.length <= asset.previousBytes, `${asset.publicPath} exceeds the replaced image's bytes`)
    assert.ok(publicCode.includes(`"${asset.publicPath}"`), `${asset.publicPath} must be used by a public slot`)
    const metadata = await sharp(output).metadata()
    assert.equal(metadata.format, "webp")
    assert.equal(metadata.width, asset.width)
    assert.equal(metadata.height, asset.height)
    assert.equal(metadata.width * 3, metadata.height * 4, "service and home slots use a 4:3 crop")
    for (const name of ["exif", "icc", "xmp", "iptc", "orientation"]) {
      assert.equal(metadata[name], undefined, `${asset.publicPath} retains ${name} metadata`)
    }
    for (const chunk of webpChunks(output)) {
      assert.ok(["VP8 ", "VP8L", "VP8X", "ALPH"].includes(chunk), `${asset.publicPath} retains non-image chunk ${chunk}`)
    }
  }
})
