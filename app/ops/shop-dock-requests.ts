/** Surface unavailable dock data as an error instead of a false empty state. */
export async function readDockJson<T>(path: string, failure: string, request: typeof fetch = fetch): Promise<T> {
  const response = await request(path)
  if (!response.ok) throw new Error(failure)
  return response.json() as Promise<T>
}

/** Clear only after the server acknowledges the request; retain local answers on failure. */
export async function clearDockAnswers(request: typeof fetch = fetch): Promise<void> {
  const response = await request("/api/ops/handset-slips", { method: "DELETE" })
  if (!response.ok) throw new Error("Saved answers could not be cleared.")
}
