const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? ""
const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? ""

if (!accountSid || !authToken) {
  console.error("Twilio account credentials are not configured in this environment.")
  process.exitCode = 1
} else {
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/IncomingPhoneNumbers.json?PageSize=50`,
    { headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}` } },
  )
  const payload = await response.json().catch(() => ({}))
  const numbers = Array.isArray(payload.incoming_phone_numbers) ? payload.incoming_phone_numbers : []
  console.log(JSON.stringify({
    credentialsValid: response.ok,
    status: response.status,
    numberCount: numbers.length,
    numbers: numbers.map((number) => ({
      phone: number.phone_number,
      voice: Boolean(number.capabilities?.voice),
      sms: Boolean(number.capabilities?.SMS),
      friendlyName: number.friendly_name,
    })),
  }, null, 2))
  if (!response.ok) process.exitCode = 1
}
