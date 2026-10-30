export type SavedPhotoIntent = {
  id: string
  scope: string
  leadId: number
  mode: "completion" | "addendum"
  contentHash: string
  original: Blob
  originalName: string
  file: Blob
  filename: string
  contentType: string
  prepared: boolean
  state: "queued" | "ready" | "archived"
  createdAt: number
  attempts: number
  nextAttemptAt: number
}

const PHOTO_DB = "mcsw-photo-outbox"
const PHOTO_STORE = "photo_intents"

function photoDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(PHOTO_DB, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PHOTO_STORE)) request.result.createObjectStore(PHOTO_STORE, { keyPath: "id" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error("Photo storage could not open."))
    request.onblocked = () => reject(new Error("Close older shop tabs to open photo storage."))
  })
}

export async function savePhotoIntent(intent: SavedPhotoIntent) {
  const db = await photoDb()
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(PHOTO_STORE, "readwrite")
    transaction.objectStore(PHOTO_STORE).put(intent)
    transaction.oncomplete = () => resolve()
    transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error("The photo could not be saved on this device."))
  }).finally(() => db.close())
}

export async function readPhotoIntents(scope: string, leadId: number, mode: SavedPhotoIntent["mode"], includeArchived = false) {
  const db = await photoDb()
  return new Promise<SavedPhotoIntent[]>((resolve, reject) => {
    const transaction = db.transaction(PHOTO_STORE, "readonly")
    const request = transaction.objectStore(PHOTO_STORE).getAll()
    request.onsuccess = () => resolve((request.result as SavedPhotoIntent[])
      .filter(intent => intent.scope === scope && intent.leadId === leadId && intent.mode === mode && (includeArchived || intent.state !== "archived"))
      .sort((a, b) => a.createdAt - b.createdAt))
    request.onerror = transaction.onabort = () => reject(request.error || new Error("Saved photos could not be reopened."))
  }).finally(() => db.close())
}

/** Keep original bytes, including after upload/filing. A retry uses this same ID. */
export async function queuePhotoCapture(file: File, scope: string, leadId: number, mode: SavedPhotoIntent["mode"]) {
  if (!/^operator:[1-9][0-9]*:(owner|crew)$/.test(scope) || !Number.isInteger(leadId) || leadId <= 0) throw new Error("Check your sign-in before saving this photo.")
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer())
  const contentHash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("")
  const intent: SavedPhotoIntent = {
    id: crypto.randomUUID(), scope, leadId, mode, contentHash, original: file, originalName: file.name,
    file, filename: file.name, contentType: file.type, prepared: false, state: "queued", createdAt: Date.now(), attempts: 0, nextAttemptAt: 0,
  }
  const db = await photoDb()
  return new Promise<SavedPhotoIntent>((resolve, reject) => {
    // A single read/write transaction serializes identical captures across tabs.
    const transaction = db.transaction(PHOTO_STORE, "readwrite")
    const store = transaction.objectStore(PHOTO_STORE)
    const request = store.getAll()
    let saved = intent
    request.onsuccess = () => {
      const existing = (request.result as SavedPhotoIntent[]).find(candidate => candidate.scope === scope && candidate.leadId === leadId && candidate.mode === mode && candidate.contentHash === contentHash)
      if (existing) saved = existing
      else store.put(intent)
    }
    transaction.oncomplete = () => resolve(saved)
    transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error("The photo could not be saved on this device."))
  }).finally(() => db.close())
}
