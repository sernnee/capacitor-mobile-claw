/**
 * Retry logic with exponential backoff + jitter for transient API errors.
 */

function isRetryable(err: any): boolean {
  const status = err.status || err.statusCode
  if (status === 429 || status === 502 || status === 503) return true
  const msg = (err.message || '').toLowerCase()
  return msg.includes('rate limit') || msg.includes('overloaded') || msg.includes('timeout')
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxRetries?: number; baseDelayMs?: number; maxDelayMs?: number } = {},
  onRetry?: (attempt: number, delayMs: number, error: Error) => void,
): Promise<T> {
  const { maxRetries = 2, baseDelayMs = 2000, maxDelayMs = 30000 } = opts
  let lastError: Error | undefined
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      lastError = err
      if (attempt === maxRetries || !isRetryable(err)) throw err
      const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs)
      const jitter = delay * (0.5 + Math.random() * 0.5)
      onRetry?.(attempt + 1, jitter, err)
      await new Promise((r) => setTimeout(r, jitter))
    }
  }
  throw lastError as Error
}
