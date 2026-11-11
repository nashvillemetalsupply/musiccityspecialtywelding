import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

// Run from the repository with Node 22:
// & "C:/Users/Owner/AppData/Local/hermes/node/node.exe" --experimental-strip-types scripts/qa/fable-r1-assistant-before.mjs
// No arguments or production mode. Generated code and the reproduced report
// stay in ignored .tmp; the committed before report is never overwritten.
// Pin both the harness and question bank, the four original routing/knowledge
// modules, service-page knowledge data, and every public-copy file read by that
// original knowledge module.
const baselineRef = "c7827bcef7ca902500d1780c0d67cb072ba5d140"
const root = fileURLToPath(new URL("../../", import.meta.url))
const temporary = new URL("../../.tmp/", import.meta.url)
const output = ".tmp/assistant-audit-fable-r1-before.json"
assert.equal(process.argv.length, 2, "This offline baseline script accepts no arguments or production mode.")
assert.ok(Number(process.versions.node.split(".")[0]) >= 22, "Use Node 22 or newer for the offline module hooks.")

const fromGit = (path) => execFileSync("git", ["show", `${baselineRef}:${path}`], { cwd: root, encoding: "utf8", windowsHide: true })
const replaceOnce = (source, needle, replacement) => {
  assert.equal(source.split(needle).length, 2, `Expected one baseline harness anchor: ${needle}`)
  return source.replace(needle, replacement)
}

mkdirSync(temporary, { recursive: true })
writeFileSync(new URL("fable-r1-assistant-before-bank.mjs", temporary), fromGit("scripts/assistant-audit-bank.mjs"))
let source = fromGit("scripts/assistant-audit-run.mjs")
source = replaceOnce(source, 'from "./assistant-audit-bank.mjs"', 'from "./fable-r1-assistant-before-bank.mjs"')
for (const name of ["assistant-a4-fixture", "assistant-a4-safety"]) {
  source = replaceOnce(source, `from "./${name}.mjs"`, `from "../scripts/${name}.mjs"`)
}
source = replaceOnce(source, "const args = process.argv.slice(2)", `const args = ${JSON.stringify(["--baseline", "--output", output])}`)
source = replaceOnce(source, 'const prod = args.includes("--prod"), baseline = args.includes("--baseline")', "const prod = false, baseline = true")
source = replaceOnce(source, 'const baselineRef = "69c9fc5e05a1d98c642ccef1eb3a2bf8a6dcd59f"', `const baselineRef = "${baselineRef}"`)
source = replaceOnce(source, '"lib/assistant/knowledge.ts"].includes(path)', '"lib/assistant/knowledge.ts", "lib/service-pages.ts"].includes(path)')
// Always read turn/contact/service/knowledge from the pinned Git ref, even if
// an unrelated local baseline snapshot happens to exist in .tmp.
source = replaceOnce(source,
  'baselineFile ? existsSync(snapshot) ? readFileSync(snapshot, "utf8") : execFileSync',
  "baselineFile ? execFileSync")
// Inline the original brand/home/area/form copy before transpiling knowledge.
// Current client component extraction and shared city lists cannot alter it.
source = replaceOnce(source, "const source = ts.transpileModule(input,", String.raw`const prepared = baseline && path === "lib/assistant/knowledge.ts" ? input.replace(/readFileSync\(join\(process.cwd\(\), "([^"]+)"\), "utf8"\)/g, (_match, relativePath) => JSON.stringify(execFileSync("git", ["show", baselineRef + ":" + relativePath], { cwd: root, encoding: "utf8", windowsHide: true }))) : input;
        const source = ts.transpileModule(prepared,`)

const runner = new URL("fable-r1-assistant-before-run.mjs", temporary)
writeFileSync(runner, source)
const result = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(runner)], { cwd: root, stdio: "inherit", windowsHide: true })
assert.ifError(result.error)
assert.equal(result.status, 0, "The blocked offline baseline harness must succeed.")
const report = JSON.parse(readFileSync(new URL(`../../${output}`, import.meta.url), "utf8"))
assert.equal(report.baselineRef, baselineRef)
assert.equal(report.total, 143)
assert.deepEqual(report.counts, { ANSWERED: 42, HANDOFF: 101, WRONG: 0, "DEAD END": 0 })
assert.equal(report.outboundAttempts.length, 0)
