import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import ts from "typescript"
import { pathToFileURL } from "node:url"

const budgetPath = new URL("./bundle-budget.json", import.meta.url)

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"))
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}

function routeKeys(route) {
  const pagePath = route === "/" ? "/page" : `${route}/page`
  return [route, pagePath, `app${pagePath}`]
}

function assetsForRoute(manifest, route) {
  if (!manifest) return { found: false, assets: [] }
  const pages = manifest.pages ?? {}
  const key = routeKeys(route).find((candidate) => Object.hasOwn(pages, candidate))
  if (!key) return { found: false, assets: [] }

  const pageAssets = pages[key]
  const files = Array.isArray(pageAssets)
    ? pageAssets
    : Array.isArray(pageAssets?.files)
      ? pageAssets.files
      : Array.isArray(pageAssets?.scripts)
        ? pageAssets.scripts
        : []
  return {
    found: true,
    assets: [
      ...(manifest.polyfillFiles ?? []),
      ...(manifest.rootMainFiles ?? []),
      ...files,
    ],
  }
}

function toBuildPath(distDir, asset) {
  const cleanAsset = String(asset).split("?", 1)[0].replaceAll("\\", "/")
  const distPrefix = `${path.basename(path.resolve(distDir)).replaceAll("\\", "/")}/`
  const withoutDistPrefix = cleanAsset.startsWith(distPrefix) ? cleanAsset.slice(distPrefix.length) : cleanAsset
  const relative = withoutDistPrefix.replace(/^\/?_next\//, "")
  const resolved = path.resolve(distDir, relative)
  const relativeToDist = path.relative(path.resolve(distDir), resolved)
  if (relativeToDist.startsWith("..") || path.isAbsolute(relativeToDist)) {
    throw new Error(`Manifest asset escapes the build directory: ${asset}`)
  }
  return resolved
}

function property(node, key) {
  if (!node || !ts.isObjectLiteralExpression(node)) return null
  const match = node.properties.find((item) => ts.isPropertyAssignment(item) && (
    (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) && item.name.text === key
  ))
  return match?.initializer ?? null
}

function stringValues(node) {
  if (!node) return []
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text]
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(stringValues)
  if (ts.isObjectLiteralExpression(node)) return node.properties.flatMap((item) => (
    ts.isPropertyAssignment(item) ? stringValues(item.initializer) : []
  ))
  return []
}

function clientReferenceAssets(source, routeKey, fileName) {
  const ast = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  let entry = null
  const visit = (node) => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isElementAccessExpression(node.left)) {
      const target = node.left.expression
      const key = node.left.argumentExpression
      if (
        ts.isPropertyAccessExpression(target)
        && ts.isIdentifier(target.expression)
        && target.expression.text === "globalThis"
        && target.name.text === "__RSC_MANIFEST"
        && key
        && (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key))
        && key.text === routeKey
        && ts.isObjectLiteralExpression(node.right)
      ) entry = node.right
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  if (!entry) return []

  const entryJsFiles = property(entry, "entryJSFiles")
  if (entryJsFiles) return stringValues(entryJsFiles).filter((asset) => /\.m?js(?:\?|$)/i.test(asset))

  const clientModules = property(entry, "clientModules")
  if (!clientModules || !ts.isObjectLiteralExpression(clientModules)) return []
  return clientModules.properties.flatMap((moduleEntry) => {
    if (!ts.isPropertyAssignment(moduleEntry)) return []
    const chunks = property(moduleEntry.initializer, "chunks")
    return stringValues(chunks).filter((asset) => /\.m?js(?:\?|$)/i.test(asset))
  })
}

async function appRouterAssets(distDir, route, manifests) {
  const appPaths = await readJson(path.join(distDir, "server", "app-paths-manifest.json"))
  if (!appPaths) return null
  const routeKey = routeKeys(route).find((key) => Object.hasOwn(appPaths, key))
  if (!routeKey) return null

  const serverEntry = appPaths[routeKey]
  const routeManifestPath = path.join(distDir, "server", `${serverEntry.replace(/\.js$/i, "")}`, "build-manifest.json")
  const routeManifest = await readJson(routeManifestPath)
  const referencePath = path.join(distDir, "server", serverEntry.replace(/\.js$/i, "_client-reference-manifest.js"))
  let referenceSource
  try {
    referenceSource = await readFile(referencePath, "utf8")
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }

  const sharedAssets = manifests.flatMap((manifest) => [
    ...(manifest.polyfillFiles ?? []),
    ...(manifest.rootMainFiles ?? []),
  ])
  const routeSharedAssets = routeManifest
    ? [...(routeManifest.polyfillFiles ?? []), ...(routeManifest.rootMainFiles ?? [])]
    : []
  return [
    ...sharedAssets,
    ...routeSharedAssets,
    ...clientReferenceAssets(referenceSource, routeKey, referencePath),
  ]
}

async function diagnosticRouteAssets(distDir, route) {
  const stats = await readJson(path.join(distDir, "diagnostics", "route-bundle-stats.json"))
  const entry = stats?.find((item) => item.route === route)
  return entry?.firstLoadChunkPaths ?? null
}

async function loadManifests(distDir) {
  const [buildManifest, appBuildManifest, serverAppBuildManifest] = await Promise.all([
    readJson(path.join(distDir, "build-manifest.json")),
    readJson(path.join(distDir, "app-build-manifest.json")),
    readJson(path.join(distDir, "server", "app-build-manifest.json")),
  ])
  const manifests = [buildManifest, appBuildManifest, serverAppBuildManifest].filter(Boolean)
  if (manifests.length === 0) {
    throw new Error(`No build-manifest.json or app-build-manifest.json found under ${distDir}`)
  }
  return manifests
}

export async function measureRoute(distDir, route, manifests) {
  const routeAssets = manifests.map((manifest) => assetsForRoute(manifest, route))
  let assets = await diagnosticRouteAssets(distDir, route)
  if (!assets?.length) {
    assets = routeAssets.some(({ found }) => found)
      ? routeAssets.flatMap(({ assets: foundAssets }) => foundAssets)
      : await appRouterAssets(distDir, route, manifests)
  }
  if (!assets?.length) return { route, measured: false, bytes: null, files: [] }

  const files = new Map()
  for (const rawAsset of assets) {
    const asset = String(rawAsset)
    if (/\.(?:m?js)(?:\?|$)/i.test(asset)) files.set(toBuildPath(distDir, asset), asset)
  }
  const measuredFiles = await Promise.all([...files].map(async ([filePath, asset]) => ({
    asset,
    bytes: (await stat(filePath)).size,
  })))
  return {
    route,
    measured: true,
    bytes: measuredFiles.reduce((sum, file) => sum + file.bytes, 0),
    files: measuredFiles,
  }
}

function formatLargestChunks(files, limit = 5) {
  const largest = [...files]
    .sort((left, right) => right.bytes - left.bytes || left.asset.localeCompare(right.asset))
    .slice(0, limit)
  return largest.length
    ? largest.map(({ asset, bytes }) => `${asset} (${bytes.toLocaleString("en-US")} bytes)`).join(", ")
    : "none"
}

export async function checkBundleBudgets({
  distDir = ".next",
  budgets,
  log = () => {},
  measureOnly = false,
}) {
  const manifests = await loadManifests(distDir)
  const results = []
  const routeBudgets = budgets?.manifestUnit?.routes
  if (!routeBudgets || typeof routeBudgets !== "object" || Array.isArray(routeBudgets) || Object.keys(routeBudgets).length === 0) {
    throw new Error("No manifest-unit route budgets configured")
  }

  for (const [route, config] of Object.entries(routeBudgets)) {
    if (config?.thresholdBytes != null && (!Number.isSafeInteger(config.thresholdBytes) || config.thresholdBytes < 0)) {
      throw new Error(`Invalid manifest-unit threshold for ${route}`)
    }
    const result = await measureRoute(distDir, route, manifests)
    results.push(result)
    if (!result.measured) {
      log(`${route}: size unavailable (no route entry in build manifests); not enforced`)
      continue
    }

    const size = result.bytes.toLocaleString("en-US")
    const largest = formatLargestChunks(result.files)
    if (measureOnly) {
      log(`${route}: total ${size} bytes (measure-only); largest chunks: ${largest}`)
    } else if (config.thresholdBytes == null) {
      log(`${route}: total ${size} bytes; no manifest-unit threshold, not enforced`)
    } else if (result.bytes > config.thresholdBytes) {
      log(`${route}: total ${size} bytes exceeds threshold ${config.thresholdBytes.toLocaleString("en-US")} bytes; largest chunks: ${largest}`)
    } else {
      log(`${route}: total ${size} / threshold ${config.thresholdBytes.toLocaleString("en-US")} bytes`)
    }
  }

  const failures = measureOnly ? [] : results.flatMap((result) => {
    const thresholdBytes = routeBudgets[result.route]?.thresholdBytes
    return result.measured && thresholdBytes != null && result.bytes > thresholdBytes
      ? [{ ...result, thresholdBytes }]
      : []
  })
  return { results, failures }
}

async function main() {
  const budgets = JSON.parse(await readFile(budgetPath, "utf8"))
  const distDir = process.env.NEXT_DIST_DIR || ".next"
  const measureOnly = process.argv.includes("--measure-only")
  if (measureOnly) {
    const buildId = (await readFile(path.join(distDir, "BUILD_ID"), "utf8")).trim()
    console.log(`Build ID: ${buildId}`)
  }
  const { failures } = await checkBundleBudgets({
    distDir,
    budgets,
    log: console.log,
    measureOnly,
  })
  if (!measureOnly && failures.length) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
