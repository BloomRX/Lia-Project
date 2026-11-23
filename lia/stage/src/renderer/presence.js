import { createAvatarView } from './avatar-view.js'

const canvas = document.querySelector('canvas')
const status = document.querySelector('#presence-status')
let view
try {
  const bytes = await window.liaStagePresence.read()
  if (!(bytes instanceof Uint8Array))
    throw new Error('presence-avatar')
  view = createAvatarView(canvas)
  await view.load(bytes.buffer)
}
catch {
  view?.dispose()
  view = undefined
  canvas.style.display = 'none'
  status.hidden = false
  status.textContent = 'Não foi possível mostrar o avatar.'
}
window.addEventListener('pagehide', () => view?.dispose(), { once: true })
