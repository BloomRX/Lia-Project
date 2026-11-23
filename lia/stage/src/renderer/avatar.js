import { maxAvatarBytes } from './avatar-file.js'

const details = document.querySelector('#avatar')
const picker = document.querySelector('#avatar-file')
let canvas = document.querySelector('#avatar-canvas')
const status = document.querySelector('#avatar-status')
let view

function releaseClosedPreview() {
  if (!details.open && !picker.disabled && view) {
    view.dispose()
    view = undefined
    const replacement = canvas.cloneNode()
    replacement.hidden = true
    canvas.replaceWith(replacement)
    canvas = replacement
    status.textContent = ''
  }
}

picker.addEventListener('change', async () => {
  const file = picker.files[0]
  if (!file)
    return
  if (file.size > maxAvatarBytes) {
    status.textContent = 'Escolha um arquivo VRM de até 64 MB.'
    picker.value = ''
    return
  }
  picker.disabled = true
  status.textContent = 'Carregando avatar…'
  try {
    const { createAvatarView } = await import('./avatar-view.js')
    view ??= createAvatarView(canvas)
    await view.load(await file.arrayBuffer())
    canvas.hidden = false
    status.textContent = 'Avatar carregado.'
  }
  catch {
    status.textContent = 'Não foi possível abrir este avatar. Escolha um arquivo VRM com recursos incorporados.'
  }
  finally {
    picker.value = ''
    picker.disabled = false
    releaseClosedPreview()
  }
})

details.addEventListener('toggle', releaseClosedPreview)
window.addEventListener('pagehide', () => view?.dispose(), { once: true })
