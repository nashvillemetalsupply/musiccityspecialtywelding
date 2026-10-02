import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const phase = process.argv[2];
if (!/^(G01|P01|P02|P03)$/.test(phase || "")) throw new Error("Expected G01, P01, P02, or P03");
const root = process.cwd();
const evidence = path.join(root, "docs/polish/evidence");
const startedAt = new Date().toISOString();
const results = [];
async function check(name, args) {
  const logPath = path.join(evidence, `${phase}-${name}.log`);
  const log = createWriteStream(logPath);
  const start = Date.now();
  log.write(`Node ${process.version}\nCommand: node ${args.join(" ")}\n\n`);
  const child = spawn(process.execPath, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const exitCode = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  log.end(`\nRunner exit code: ${exitCode}\n`);
  await new Promise((resolve) => log.on("finish", resolve));
  const result = { name, exitCode, durationMs: Date.now() - start, log: path.relative(root, logPath).replaceAll("\\", "/") };
  results.push(result);
  console.log(JSON.stringify(result));
  return exitCode === 0;
}
const prerequisites = await Promise.all([
  check("lint", ["node_modules/eslint/bin/eslint.js", "."]),
  check("tests", ["--experimental-strip-types", "--test", "scripts/**/*.test.mjs"]),
]);
let passed = prerequisites.every(Boolean);
if (passed) passed = await check("build", ["node_modules/next/dist/bin/next", "build"]);
if (passed) passed = await check("bundle-budget", ["scripts/bundle-budget.mjs"]);
await writeFile(path.join(evidence, `${phase}-checks.json`), JSON.stringify({ phase, startedAt, completedAt: new Date().toISOString(), node: process.version, passed, results }, null, 2) + "\n");
process.exitCode = passed ? 0 : 1;
