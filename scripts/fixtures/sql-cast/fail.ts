const sql = String.raw
const leadId = 12
const isTest = true
const rows = sql`SELECT id FROM leads WHERE id = ${leadId} AND is_test = ${isTest}::boolean`

export {}
