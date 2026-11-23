import { t } from './locale.js'

import { maxAvatarBytes } from './avatar-file.js'

const details = document.querySelector('#avatar')
const picker = document.querySelector('#avatar-file')
const pickerButton = document.querySelector('#avatar-picker')
let canvas = document.querySelector('#avatar-canvas')
const status = document.querySelector('#avatar-status')
const actions = document.querySelector('#avatar-actions')
const show = document.querySelector('#avatar-show')
const hide = document.querySelector('#avatar-hide')
const monitor = document.querySelector('#avatar-monitor')
const commands = Array.from(document.querySelectorAll('[data-presence]'))
let view
let selectedAvatar
let presenceOpen = false
let presenceBusy = false

function updateActions() {
  actions.hidden = !selectedAvatar
  show.disabled = presenceBusy || presenceOpen
  hide.disabled = presenceBusy || !presenceOpen
  monitor.disabled = presenceBusy || !presenceOpen || monitor.options.length === 0
  for (const command of commands)
    command.disabled = presenceBusy || !presenceOpen
}

async function refreshMonitors() {
  const state = await window.liaStagePresence.displays()
  if (!state)
    throw new Error('presence-displays')
  const options = [
    new Option(t('Monitor atual'), 'current'),
    new Option(t('Todos os monitores'), 'all'),
    ...state.displays.map(({ id, workArea }, index) => new Option(
      `${t('Monitor')} ${index + 1} · ${workArea.width} × ${workArea.height}`,
      String(id),
    )),
  ]
  monitor.replaceChildren(...options)
  monitor.value = state.allMonitors ? 'all' : String(state.monitorId ?? 'current')
  if (!monitor.value)
    monitor.value = 'current'
}

async function operate(operation) {
  presenceBusy = true
  updateActions()
  try {
    await operation()
  }
  catch {
    status.textContent = t('Não foi possível alterar a presença no desktop.')
  }
  finally {
    presenceBusy = false
    updateActions()
  }
}

show.addEventListener('click', () => void operate(async () => {
  if (!await window.liaStagePresence.open(new Uint8Array(selectedAvatar)))
    throw new Error('presence')
  presenceOpen = true
  await refreshMonitors()
  status.textContent = t('Avatar aberto no desktop.')
}))
hide.addEventListener('click', () => void operate(async () => {
  await window.liaStagePresence.close()
  presenceOpen = false
  status.textContent = t('Avatar oculto.')
}))
for (const command of commands) {
  command.addEventListener('click', () => void operate(async () => {
    if (!await window.liaStagePresence.command(command.dataset.presence))
      throw new Error('presence')
    status.textContent = t('Presença atualizada.')
  }))
}
monitor.addEventListener('change', () => void operate(async () => {
  const selection = monitor.value === 'current' ? null : monitor.value === 'all' ? 'all' : Number(monitor.value)
  const changed = await window.liaStagePresence.command({ monitor: selection })
  await refreshMonitors()
  if (!changed)
    throw new Error('presence-displays')
  status.textContent = t('Presença atualizada.')
}))
window.addEventListener('focus', () => {
  if (presenceOpen && !presenceBusy)
    void refreshMonitors().catch(() => {})
})

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

pickerButton.addEventListener('click', () => picker.click())
picker.addEventListener('change', async () => {
  const file = picker.files[0]
  if (!file)
    return
  if (file.size > maxAvatarBytes) {
    status.textContent = t('Escolha um arquivo VRM de até 64 MB.')
    picker.value = ''
    return
  }
  picker.disabled = true
  pickerButton.disabled = true
  status.textContent = t('Carregando avatar…')
  try {
    const { createAvatarView } = await import('./avatar-view.js')
    view ??= createAvatarView(canvas)
    const bytes = await file.arrayBuffer()
    await view.load(bytes)
    selectedAvatar = bytes
    updateActions()
    canvas.hidden = false
    status.textContent = t('Avatar carregado.')
  }
  catch {
    status.textContent = t('Não foi possível abrir este avatar. Escolha um arquivo VRM com recursos incorporados.')
  }
  finally {
    picker.value = ''
    picker.disabled = false
    pickerButton.disabled = false
    releaseClosedPreview()
  }
})

details.addEventListener('toggle', releaseClosedPreview)
window.addEventListener('pagehide', () => view?.dispose(), { once: true })
