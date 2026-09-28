import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { Linter } from "eslint"
import test from "node:test"
import requireSqlCast from "./eslint-rules/require-sql-cast.mjs"

const fixtures = path.join(import.meta.dirname, "fixtures", "sql-cast")
const config = [{
  languageOptions: { ecmaVersion: "latest", sourceType: "module" },
  plugins: { mcsw: { rules: { "require-sql-cast": requireSqlCast } } },
  rules: { "mcsw/require-sql-cast": "error" },
}]

async function lintFixture(name) {
  const code = await readFile(path.join(fixtures, name), "utf8")
  return new Linter().verify(code, config)
}

test("SQL cast rule accepts typed interpolations", async () => {
  const messages = await lintFixture("pass.ts")
  assert.deepEqual(messages, [])
})

test("SQL cast rule reports each uncast interpolation", async () => {
  const messages = await lintFixture("fail.ts")
  assert.equal(messages.length, 1)
  assert.match(messages[0].message, /explicit Postgres ::cast/)
})

test("SQL cast rule ignores templates that are not tagged sql", () => {
  const messages = new Linter().verify("const text = `id = ${leadId}`", config)
  assert.deepEqual(messages, [])
})
