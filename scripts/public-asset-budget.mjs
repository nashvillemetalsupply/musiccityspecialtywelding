import { readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const MAX_PUBLIC_ASSET_BYTES = 2_000_000

export function validatePublicAssets(assets) {
  for (const { name, bytes } of assets) {
    if (/\.(?:mp4|webm|mov|m4v|mp3|wav)$/i.test(name)) {
      throw new Error(`${name}: serve video and audio outside Vercel`)
    }
    if (bytes > MAX_PUBLIC_ASSET_BYTES) {
      throw new Error(`${name}: public assets above 2 MB require external hosting or compression`)
    }
  }
}

export function checkPublicAssetBudget(root = fileURLToPath(new URL("../public", import.meta.url))) {
  const assets = []
  const inspect = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`${relative(root, path)}: public asset symlinks cannot bypass the media budget`)
      if (entry.isDirectory()) inspect(path)
      else assets.push({ name: relative(root, path), bytes: statSync(path).size })
    }
  }
  inspect(root)
  validatePublicAssets(assets)
  return assets.length
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(`Public asset budget passed: ${checkPublicAssetBudget()} files, no video/audio, each <= 2 MB`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
