const maxResponseBytes = 96 * 1024

/** Bounded response decoding. Exceptions remain inside Main. */
export async function readOidcJson(response: Response, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted()
  const reader = response.body?.getReader()
  if (!reader)
    return undefined
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const cancel = () => {
    void reader.cancel().catch(() => {})
  }
  signal.addEventListener('abort', cancel, { once: true })
  let bytes = 0
  let text = ''
  try {
    for (;;) {
      signal.throwIfAborted()
      const chunk = await reader.read()
      signal.throwIfAborted()
      if (chunk.done)
        return JSON.parse(text + decoder.decode()) as unknown
      bytes += chunk.value.byteLength
      if (bytes > maxResponseBytes)
        throw new Error('OIDC response exceeded the size limit')
      text += decoder.decode(chunk.value, { stream: true })
    }
  }
  finally {
    signal.removeEventListener('abort', cancel)
    cancel()
    reader.releaseLock()
  }
}
