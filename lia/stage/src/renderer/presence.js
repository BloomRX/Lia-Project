import './locale.js'

import { createAvatarView } from './avatar-view.js'

const canvas = document.querySelector('canvas')
let view
const presence = window.liaStagePresence
let visible = true
let expression = 'idle'
let expressionEvents = 0
let disposed = false
const unlisten = presence.onVisibility((value) => {
  visible = value
  view?.setRenderingEnabled(value)
})
const unlistenExpression = presence.onExpression((phase) => {
  expressionEvents++
  expression = phase
  view?.setExpressionPhase(phase)
})
const unlistenAvatar = presence.onAvatarChanged(async (id, bytes) => {
  let rendered = false
  try {
    if (view && !disposed) {
      await load(bytes)
      rendered = true
    }
  }
  catch {
    // The existing scene remains available when the new file cannot be loaded.
  }
  if (!disposed)
    presence.reportRender(rendered, id)
})
window.addEventListener('pagehide', () => {
  disposed = true
  unlisten()
  unlistenExpression()
  unlistenAvatar()
  view?.dispose()
}, { once: true })

function load(bytes) {
  if (!(bytes instanceof Uint8Array))
    throw new Error('presence-avatar')
  return view.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}

try {
  const revision = expressionEvents
  const [bytes, initialExpression] = await Promise.all([
    presence.read(),
    presence.expression(),
  ])
  if (disposed)
    throw new Error('presence-closed')
  if (revision === expressionEvents)
    expression = initialExpression
  view = createAvatarView(canvas)
  view.setRenderingEnabled(visible)
  view.setExpressionPhase(expression)
  await load(bytes)
  if (!disposed)
    presence.reportRender(true)
}
catch {
  view?.dispose()
  view = undefined
  if (!disposed)
    presence.reportRender(false)
}
