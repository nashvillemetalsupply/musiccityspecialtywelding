import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const workflow = readFileSync(new URL("../.github/workflows/backup.yml", import.meta.url), "utf8")

test("weekly backup workflow creates a custom-format dump and retains its artifact for 90 days", () => {
  assert.match(workflow, /^name: Weekly Neon backup$/m)
  assert.match(workflow, /^    - cron: "5 12 \* \* 0"$/m)
  assert.match(workflow, /^  workflow_dispatch:$/m)
  assert.match(workflow, /DATABASE_URL_UNPOOLED: \$\{\{ secrets\.DATABASE_URL_UNPOOLED \}\}/)
  assert.match(workflow, /postgres:17-alpine/)
  assert.match(workflow, /pg_dump --format=custom/)
  assert.match(workflow, /actions\/upload-artifact@v4/)
  assert.match(workflow, /retention-days: 90/)
  assert.match(workflow, /timeout-minutes: 30/)
})
