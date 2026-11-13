import assert from "node:assert/strict"
import test from "node:test"
import nextConfig from "../next.config.ts"
import { checkPublicAssetBudget } from "./public-asset-budget.mjs"

test("next.config.ts caches public marketing assets without caching private routes or mutable assets forever", async () => {
  const rules = await nextConfig.headers()
  const cacheRules = rules.filter((rule) => rule.headers.some(({ key }) => key.toLowerCase() === "cache-control"))
  assert.deepEqual(cacheRules.map(({ source }) => source).sort(), ["/brand/:path*", "/images/:path*"])
  for (const rule of cacheRules) {
    const policy = rule.headers.find(({ key }) => key.toLowerCase() === "cache-control").value
    assert.equal(policy, "public, max-age=86400, must-revalidate")
    assert.ok(!policy.includes("immutable"), "marketing assets can change without changing their names")
  }
  assert.deepEqual(nextConfig.images.formats, ["image/avif", "image/webp"])
  assert.equal(nextConfig.images.unoptimized, undefined)
})

test("public asset budget keeps large media off Vercel", () => {
  assert.ok(checkPublicAssetBudget() > 0)
})
