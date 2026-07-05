import "server-only"

export async function validateApifyToken(token: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!token?.trim()) return false
  try {
    const r = await fetchImpl(`https://api.apify.com/v2/users/me?token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(10_000) })
    return r.ok
  } catch { return false }
}

export async function validateOpenAiKey(key: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!key?.trim()) return false
  try {
    const r = await fetchImpl("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) })
    return r.ok
  } catch { return false }
}
