import assert from "node:assert/strict"
import { readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import nextConfig from "../next.config.ts"

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
  const root = fileURLToPath(new URL("../public", import.meta.url))
  const inspect = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) inspect(path)
      else {
        const name = relative(root, path)
        assert.ok(!/\.(?:mp4|webm|mov|m4v|mp3|wav)$/i.test(name), `${name}: serve video and audio outside Vercel`)
        assert.ok(statSync(path).size <= 2_000_000, `${name}: public assets above 2 MB require external hosting or compression`)
      }
    }
  }
  inspect(root)
})
