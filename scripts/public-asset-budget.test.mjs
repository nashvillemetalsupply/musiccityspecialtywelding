import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { checkPublicAssetBudget, MAX_PUBLIC_ASSET_BYTES, validatePublicAssets } from "./public-asset-budget.mjs"

test("package.json runs the public asset budget before the production build", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  assert.equal(pkg.scripts.prebuild, "node scripts/public-asset-budget.mjs")
  assert.match(pkg.scripts.build, /^next build\b/)
  assert.ok(checkPublicAssetBudget() > 0)
})

test("public-asset-budget.mjs rejects large files and media regardless of filename case", () => {
  assert.doesNotThrow(() => validatePublicAssets([{ name: "hero.avif", bytes: MAX_PUBLIC_ASSET_BYTES }]))
  assert.throws(() => validatePublicAssets([{ name: "hero.jpg", bytes: MAX_PUBLIC_ASSET_BYTES + 1 }]), /above 2 MB/)
  for (const extension of ["mp4", "webm", "mov", "m4v", "mp3", "wav"]) {
    assert.throws(() => validatePublicAssets([{ name: `nested/CLIP.${extension.toUpperCase()}`, bytes: 1 }]), /outside Vercel/)
  }
})
