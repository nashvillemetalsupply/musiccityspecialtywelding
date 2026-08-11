const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? ""
const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? ""

function memorabilityScore(phone) {
  const digits = phone.replace(/\D/g, "").slice(-7)
  let score = 0
  for (let index = 1; index < digits.length; index += 1) {
    if (digits[index] === digits[index - 1]) score += 4
  }
  const chunks = [digits.slice(0, 3), digits.slice(3)]
  for (const chunk of chunks) {
    if (/^(\d)\1+$/.test(chunk)) score += 18
    if (/^(\d)(\d)\1\2$/.test(chunk)) score += 14
    if (/^(\d)\1(\d)\2$/.test(chunk)) score += 12
    if (["0123", "1234", "2345", "3456", "4567", "5678", "6789", "9876", "8765", "7654", "6543", "5432", "4321", "3210"].some((sequence) => chunk.includes(sequence))) score += 16
  }
  if (digits.endsWith("9353")) score += 50 // WELD on a phone keypad.
  if (/000$|111$|222$|333$|444$|555$|666$|777$|888$|999$/.test(digits)) score += 20
  if (new Set(digits).size <= 4) score += 10
  if (digits.slice(0, 3) === digits.slice(4)) score += 8
  return score
}

async function search(locality) {
  const params = new URLSearchParams({
    AreaCode: "615",
    InLocality: locality,
    VoiceEnabled: "true",
    PageSize: "1000",
  })
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/AvailablePhoneNumbers/US/Local.json?${params}`,
    { headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}` } },
  )
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.message || `Twilio search failed (${response.status}).`)
  const numbers = Array.isArray(payload.available_phone_numbers) ? payload.available_phone_numbers : []
  return numbers
    .filter((number) => number.phone_number?.startsWith("+1615") && number.locality === locality && number.capabilities?.voice)
    .map((number) => ({
      phone: number.phone_number,
      locality: number.locality,
      region: number.region,
      score: memorabilityScore(number.phone_number),
    }))
    .sort((left, right) => right.score - left.score || left.phone.localeCompare(right.phone))
    .slice(0, 20)
}

if (!accountSid || !authToken) {
  console.error("Twilio account credentials are not configured in this environment.")
  process.exitCode = 1
} else {
  try {
    const lebanon = await search("Lebanon")
    const nashville = await search("Nashville")
    console.log(JSON.stringify({ areaCode: "615", preference: ["Lebanon", "Nashville"], lebanon, nashville }, null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Twilio search failed.")
    process.exitCode = 1
  }
}
