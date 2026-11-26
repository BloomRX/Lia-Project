import './locale.js'

import { createAvatarView } from './avatar-view.js'

const canvas = document.querySelector('canvas')
let view
const unlisten = window.liaStagePresence.onVisibility(visible => view?.setRenderingEnabled(visible))
window.addEventListener('pagehide', () => {
  unlisten()
  view?.dispose()
}, { once: true })
try {
  const bytes = await window.liaStagePresence.read()
  if (!(bytes instanceof Uint8Array))
    throw new Error('presence-avatar')
  view = createAvatarView(canvas)
  await view.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  window.liaStagePresence.reportRender(true)
}
catch {
  view?.dispose()
  view = undefined
  window.liaStagePresence.reportRender(false)
}
