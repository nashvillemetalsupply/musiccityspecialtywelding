import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"
import test from "node:test"

const root = fileURLToPath(new URL("../..", import.meta.url))

test("the home hero uses the 1600px source through Next image optimization", async () => {
  const page = readFileSync(join(root, "app", "page.tsx"), "utf8")
  const heroImage = /<Image\s+src="\/images\/optimized\/welder-1600\.webp"[\s\S]*?\/>/.exec(page)?.[0]
  assert.ok(heroImage, "home hero must point to the 1600px welder source")
  assert.match(heroImage, /\bsizes=/)
  assert.match(heroImage, /\bpriority\b/)
  assert.match(heroImage, /fetchPriority="high"/)
  assert.doesNotMatch(heroImage, /\bunoptimized\b/)

  const image = await sharp(join(root, "public", "images", "optimized", "welder-1600.webp")).metadata()
  assert.equal(image.width, 1600)
  assert.equal(image.height, 1280)
})
