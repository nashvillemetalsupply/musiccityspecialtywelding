import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { transformBackup } from "./backup-crypto.mjs"

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "mcsw-backup-test-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const input = join(directory, "synthetic.dump")
  const encrypted = join(directory, "synthetic.dump.enc")
  const output = join(directory, "restored.dump")
  const key = randomBytes(32).toString("hex")
  const content = Buffer.concat([Buffer.from("PGDMP synthetic test data\n"), randomBytes(262144)])
  await writeFile(input, content)
  return { directory, input, encrypted, output, key, content }
}

test("backup encryption round-trips binary data and uses a fresh nonce", async (t) => {
  const f = await fixture(t)
  await transformBackup("encrypt", f.input, f.encrypted, f.key)
  const encrypted = await readFile(f.encrypted)
  assert.equal(encrypted.includes(f.content.subarray(0, 24)), false)
  await transformBackup("decrypt", f.encrypted, f.output, f.key)
  assert.deepEqual(await readFile(f.output), f.content)
  const second = join(f.directory, "second.enc")
  await transformBackup("encrypt", f.input, second, f.key)
  assert.notDeepEqual(await readFile(second), encrypted)
})

test("wrong keys, tampering, and truncation fail without leaving plaintext output", async (t) => {
  const f = await fixture(t)
  await transformBackup("encrypt", f.input, f.encrypted, f.key)
  await assert.rejects(transformBackup("decrypt", f.encrypted, f.output, randomBytes(32).toString("hex")))
  assert.equal(existsSync(f.output), false)
  assert.deepEqual((await readdir(f.directory)).filter((name) => name.endsWith(".partial")), [])
  const original = await readFile(f.encrypted)
  for (const index of [0, 12, 30, original.length - 1]) {
    const corrupted = Buffer.from(original)
    corrupted[index] ^= 1
    await writeFile(f.encrypted, corrupted)
    await assert.rejects(transformBackup("decrypt", f.encrypted, f.output, f.key))
    assert.equal(existsSync(f.output), false)
    assert.deepEqual((await readdir(f.directory)).filter((name) => name.endsWith(".partial")), [])
  }
  await writeFile(f.encrypted, original.subarray(0, 15))
  await assert.rejects(transformBackup("decrypt", f.encrypted, f.output, f.key))
  assert.equal(existsSync(f.output), false)
  assert.deepEqual((await readdir(f.directory)).filter((name) => name.endsWith(".partial")), [])
})

test("invalid keys and existing output paths cannot overwrite or remove input", async (t) => {
  const f = await fixture(t)
  await assert.rejects(transformBackup("encrypt", f.input, f.encrypted, "too-short"))
  assert.equal(existsSync(f.encrypted), false)
  await assert.rejects(transformBackup("encrypt", f.input, f.input, f.key))
  await writeFile(f.output, "preserve existing output")
  await assert.rejects(transformBackup("encrypt", f.input, f.output, f.key))
  assert.equal(await readFile(f.output, "utf8"), "preserve existing output")
  assert.deepEqual(await readFile(f.input), f.content)
})

test("empty input can be authenticated and restored", async (t) => {
  const f = await fixture(t)
  await writeFile(f.input, "")
  await transformBackup("encrypt", f.input, f.encrypted, f.key)
  await transformBackup("decrypt", f.encrypted, f.output, f.key)
  assert.equal((await readFile(f.output)).length, 0)
})
