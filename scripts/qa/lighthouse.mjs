import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { delimiter, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = join(fileURLToPath(new URL("..", import.meta.url)), "..")
const reportDirectory = join(root, "scripts", "qa", "reports")
const productionOrigin = "https://musiccityspecialtywelding.com"
const lighthousePackage = "lighthouse@12.8.2"

export const LIGHTHOUSE_TARGETS = Object.freeze([
  { slug: "home", path: "/" },
  { slug: "service-mobile-welding", path: "/services/mobile-welding" },
  { slug: "service-areas", path: "/service-areas" },
])

export function reportFileName(date, slug) {
  return `lighthouse-${date}-${slug}.json`
}

export function findChromePath({ platform = process.platform, env = process.env, exists = existsSync } = {}) {
  if (env.CHROME_PATH && exists(env.CHROME_PATH)) return env.CHROME_PATH

  const candidates = platform === "win32"
    ? [
        env.ProgramFiles && join(env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe"),
        env["ProgramFiles(x86)"] && join(env["ProgramFiles(x86)"], "Google", "Chrome", "Application", "chrome.exe"),
        env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
      ]
    : platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
      : [
          "/usr/bin/google-chrome",
          "/usr/bin/chromium",
          "/usr/bin/chromium-browser",
          "/snap/bin/chromium",
        ]

  for (const candidate of [...candidates.filter(Boolean), ...pathChromeCandidates(platform, env.PATH)]) {
    if (exists(candidate)) return candidate
  }
  return null
}

function pathChromeCandidates(platform, pathValue = "") {
  const names = platform === "win32" ? ["chrome.exe"] : ["google-chrome", "chromium", "chromium-browser"]
  return pathValue.split(delimiter).flatMap((directory) => names.map((name) => join(directory, name)))
}

export function lighthouseArgs({ url, outputPath, chromePath }) {
  return [
    "--yes",
    lighthousePackage,
    url,
    "--output=json",
    `--output-path=${outputPath}`,
    "--form-factor=mobile",
    "--chrome-flags=--headless=new --no-sandbox",
    `--chrome-path=${chromePath}`,
    "--quiet",
  ]
}

export function runLighthouse({ date = new Date().toISOString().slice(0, 10), chromePath = findChromePath() } = {}) {
  if (!chromePath) {
    throw new Error("Chrome was not found. Set CHROME_PATH to an installed Chrome executable; Lighthouse was not started.")
  }

  mkdirSync(reportDirectory, { recursive: true })
  const reports = []
  for (const target of LIGHTHOUSE_TARGETS) {
    const outputPath = join(reportDirectory, reportFileName(date, target.slug))
    const url = new URL(target.path, productionOrigin).href
    const result = spawnSync(
      process.platform === "win32" ? "npx.cmd" : "npx",
      lighthouseArgs({ url, outputPath, chromePath }),
      { cwd: root, stdio: "inherit", shell: process.platform === "win32", windowsHide: true },
    )
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`Lighthouse failed for ${url} with exit code ${result.status}`)
    reports.push(outputPath)
    console.log(`Lighthouse report: ${outputPath}`)
  }
  return reports
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    runLighthouse()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
