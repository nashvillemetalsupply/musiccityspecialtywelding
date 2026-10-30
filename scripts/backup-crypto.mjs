import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { link, open, unlink } from "node:fs/promises"
import { resolve } from "node:path"
import { pipeline } from "node:stream/promises"
import { Readable } from "node:stream"
import { pathToFileURL } from "node:url"

const MAGIC = Buffer.from("MCSWBACKUP1\n")
const NONCE_BYTES = 12
const TAG_BYTES = 16
const HEADER_BYTES = MAGIC.length + NONCE_BYTES

function readKey(value) {
  if (!/^[a-f0-9]{64}$/i.test(value ?? "")) {
    throw new Error("BACKUP_ENCRYPTION_KEY must contain exactly 64 hexadecimal characters.")
  }
  return Buffer.from(value, "hex")
}

// Publish only complete, authenticated output. The temporary file is private,
// the key is environment-only, and a preexisting destination is never replaced.
export async function transformBackup(mode, input, output, keyValue) {
  if (mode !== "encrypt" && mode !== "decrypt") throw new Error("Choose encrypt or decrypt.")
  const key = readKey(keyValue)
  if (resolve(input) === resolve(output)) throw new Error("Input and output must differ.")
  const temporary = `${output}.${randomBytes(16).toString("hex")}.partial`
  try {
    if (mode === "encrypt") {
      const nonce = randomBytes(NONCE_BYTES)
      const header = Buffer.concat([MAGIC, nonce])
      const cipher = createCipheriv("aes-256-gcm", key, nonce)
      cipher.setAAD(header)
      await pipeline(createReadStream(input), cipher, async function* (chunks) {
        yield header
        for await (const chunk of chunks) yield chunk
        yield cipher.getAuthTag()
      }, createWriteStream(temporary, { flags: "wx", mode: 0o600 }))
    } else {
      const source = await open(input, "r")
      let size, header, tag
      try {
        size = (await source.stat()).size
        if (size < HEADER_BYTES + TAG_BYTES) throw new Error("Backup is truncated.")
        header = Buffer.alloc(HEADER_BYTES)
        tag = Buffer.alloc(TAG_BYTES)
        await source.read(header, 0, header.length, 0)
        await source.read(tag, 0, tag.length, size - TAG_BYTES)
      } finally {
        await source.close()
      }
      if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Unknown backup format.")
      const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(MAGIC.length))
      decipher.setAAD(header)
      decipher.setAuthTag(tag)
      const sourceStream = size === HEADER_BYTES + TAG_BYTES
        ? Readable.from([])
        : createReadStream(input, { start: HEADER_BYTES, end: size - TAG_BYTES - 1 })
      await pipeline(sourceStream, decipher, createWriteStream(temporary, { flags: "wx", mode: 0o600 }))
    }
    // Hard-link publication is atomic and fails if output already exists.
    await link(temporary, output)
  } finally {
    await unlink(temporary).catch(() => {})
    key.fill(0)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, input, output] = process.argv.slice(2)
  if (!input || !output || process.argv.length !== 5) {
    console.error("Usage: node scripts/backup-crypto.mjs encrypt|decrypt INPUT OUTPUT")
    process.exitCode = 1
  } else {
    transformBackup(mode, input, output, process.env.BACKUP_ENCRYPTION_KEY).then(() => {
      console.log(`Backup ${mode} completed.`)
    }).catch(() => {
      // Never print provider URLs, keys, or backup contents in a public job log.
      console.error(`Backup ${mode} failed. Check key, input format, and output permissions.`)
      process.exitCode = 1
    })
  }
}
