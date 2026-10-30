import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const workflow = readFileSync(new URL("../.github/workflows/backup.yml", import.meta.url), "utf8")

test("weekly backup creates a read-only dump and uploads only authenticated ciphertext for 90 days", () => {
  assert.match(workflow, /^name: Weekly Neon backup$/m)
  assert.match(workflow, /^    - cron: "5 12 \* \* 0"$/m)
  assert.match(workflow, /^  workflow_dispatch:$/m)
  assert.match(workflow, /DATABASE_URL_UNPOOLED: \$\{\{ secrets\.DATABASE_URL_UNPOOLED \}\}/)
  assert.doesNotMatch(workflow, /PGDATABASE: \$\{\{/)
  assert.match(workflow, /BACKUP_ENCRYPTION_KEY: \$\{\{ secrets\.BACKUP_ENCRYPTION_KEY \}\}/)
  assert.match(workflow, /trap 'rm -f mcsw-backup\.dump' EXIT/)
  assert.match(workflow, /: > mcsw-backup\.dump\s+chmod 600 mcsw-backup\.dump\s+node scripts\/backup-dump\.mjs/)
  assert.match(workflow, /backup-crypto\.mjs encrypt mcsw-backup\.dump mcsw-backup\.dump\.enc/)
  assert.match(workflow, /^          path: mcsw-backup\.dump\.enc$/m)
  assert.doesNotMatch(workflow, /^          path:.*(?:\*|dump$)/m)
  assert.match(workflow, /actions\/upload-artifact@v4/)
  assert.match(workflow, /retention-days: 90/)
  assert.match(workflow, /timeout-minutes: 30/)
})
