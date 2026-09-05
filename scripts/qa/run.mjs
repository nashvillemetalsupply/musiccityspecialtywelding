// `npm run test:qa` runs this, not `playwright test ...; node report.mjs`.
//
// The plan wrote the script as two commands joined by `;` so the report is
// written even when STRICT assertions fail — "the failures are the report".
// npm on Windows hands the string to cmd.exe, where `;` is not a separator: it
// became part of the config path and playwright died with
// "playwright.config.mjs; does not exist". Swapping `;` for `&` fixes cmd and
// breaks every POSIX shell (there it backgrounds the first command).
//
// So the sequencing lives here instead, where it is the same on both. This
// also fixes a second thing the `;` form got wrong: it swallowed playwright's
// exit code, so a STRICT run that failed every assertion still exited 0. A
// gate that cannot fail is not a gate. The report is always written; the exit
// code is playwright's.
import { spawnSync } from "node:child_process"

const config = "scripts/qa/playwright.config.mjs"
const args = process.argv.slice(2)

const gate = spawnSync("npx", ["playwright", "test", "-c", config, ...args], {
  stdio: "inherit",
  shell: process.platform === "win32",
})

const report = spawnSync(process.execPath, ["scripts/qa/report.mjs"], { stdio: "inherit" })

if (gate.error) {
  console.error(`could not start playwright: ${gate.error.message}`)
  process.exit(1)
}
process.exit(gate.status ?? report.status ?? 1)
