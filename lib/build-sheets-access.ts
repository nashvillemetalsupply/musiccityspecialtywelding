export function buildSheetsEnabled() {
  return process.env.SHOP_BRAIN_LIVING_JOB?.trim().toLowerCase() === "true"
}
