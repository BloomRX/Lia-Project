/** Adds current, consented memory to this request only, never to stored history. */
export function installMemoryChatContext(
  chat: { onBeforeSend: (hook: (text: string, context: { composedMessage?: Array<{ role: string, content?: unknown }> }) => Promise<void>) => () => void },
  retrieve: (text: string) => Promise<string>,
) {
  return chat.onBeforeSend(async (text, context) => {
    const memory = await retrieve(text)
    const messages = context.composedMessage
    if (!memory || !messages)
      return
    // Memory is untrusted user data, not a system instruction. Keep it
    // separate from the canonical persona and bounded by the Main retriever.
    const index = messages.findLastIndex(message => message.role === 'user')
    if (index >= 0)
      messages.splice(index, 0, { role: 'user', content: memory })
  })
}
