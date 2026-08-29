export const QUOTE_SERVICE_OPTIONS = Object.freeze([
  "Mobile Welding (On-Site)",
  "Trailer / Truck Welding Repair",
  "Equipment & Structural Repair",
  "Architectural Welding & Fabrication",
  "Specialty Fabrication",
  "Aluminum / Boat Welding",
  "Custom Wrought Iron Mailboxes",
  "Custom Metal Planter Boxes",
  "Stainless Countertops / Manifolds",
  "Not Sure / Other",
])

const QUOTE_SERVICE_SET = new Set(QUOTE_SERVICE_OPTIONS)

function text(value) {
  return typeof value === "string" ? value.trim() : ""
}

function validUsPhone(value) {
  const digits = text(value).replace(/\D/g, "")
  return digits.length === 10 || (digits.length === 11 && digits.startsWith("1"))
}

export function validatePublicQuote(input) {
  const firstName = text(input?.firstName)
  const lastName = text(input?.lastName)
  const phone = text(input?.phone)
  const email = text(input?.email)
  const service = text(input?.service)
  const message = text(input?.message)

  if (!firstName || !phone || !service) return "Add your name, phone, and the kind of job."
  if (firstName.length > 80 || lastName.length > 80) return "That name is too long."
  if (phone.length > 40 || !validUsPhone(phone)) return "Enter a valid US phone number."
  if (email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return "Enter a valid email address."
  if (service.length > 120 || !QUOTE_SERVICE_SET.has(service)) return "Choose a listed job type."
  if (message.length > 4000) return "Project details are too long."
  return ""
}

function ascii(bytes, start, length) {
  return String.fromCharCode(...bytes.slice(start, start + length))
}

export function detectRasterImageType(bytes) {
  if (!(bytes instanceof Uint8Array)) return null
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png"
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp"
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6))) return "image/gif"
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4).toLowerCase()
    if (["heic", "heix", "hevc", "hevx"].includes(brand)) return "image/heic"
    if (["mif1", "msf1"].includes(brand)) return "image/heif"
  }
  return null
}

export function imageTypeMatches(bytes, declaredType) {
  const normalized = text(declaredType).toLowerCase().split(";", 1)[0]
  return detectRasterImageType(bytes) === normalized
}
