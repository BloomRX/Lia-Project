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
window.addEventListener('pagehide', () => {
  disposed = true
  unlisten()
  unlistenExpression()
  view?.dispose()
}, { once: true })
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
  if (!(bytes instanceof Uint8Array))
    throw new Error('presence-avatar')
  view = createAvatarView(canvas)
  view.setRenderingEnabled(visible)
  view.setExpressionPhase(expression)
  await view.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  if (!disposed)
    presence.reportRender(true)
}
catch {
  view?.dispose()
  view = undefined
  if (!disposed)
    presence.reportRender(false)
}
