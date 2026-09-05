// One row per CRM surface. Keys are stable names the reports index by.
// Ids come from the environment so the gate never hard-codes a customer.
const job = process.env.MCSW_QA_JOB_ID
const account = process.env.MCSW_QA_ACCOUNT_ID

export const ROUTES = [
  { key: "board", path: "/board" },
  { key: "calls", path: "/board/calls" },
  { key: "customers", path: "/board/customers" },
  { key: "updates", path: "/board/updates" },
  { key: "intake", path: "/ops/intake/new" },
  job && { key: "job", path: `/ops/leads/${job}` },
  job && { key: "builds", path: `/ops/leads/${job}/builds` },
  account && { key: "account", path: `/ops/accounts/${account}` },
  { key: "analytics", path: "/ops/analytics" },
  { key: "sketch", path: "/ops/call-sketch" },
  { key: "shop", path: "/ops/shop" },
  { key: "install", path: "/ops/install" },
].filter(Boolean)

export const WIDTHS = [320, 375, 768, 1440]
export const FLOOR_PX = 14
// WCAG 2.0, 2.1 and 2.2 at A and AA. 2.1 is where the mobile rules live.
export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
