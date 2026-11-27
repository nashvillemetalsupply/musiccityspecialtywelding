export function notificationDedupePrefix(environment: string | undefined = process.env.VERCEL_ENV) {
  return environment === "production" ? "" : "preview:"
}
