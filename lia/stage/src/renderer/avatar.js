import { maxAvatarBytes } from './avatar-file.js'
import { readSavedAvatar, removeSavedAvatar, saveAvatar } from './avatar-storage.js'
import { t } from './locale.js'

const details = document.querySelector('#avatar')
const picker = document.querySelector('#avatar-file')
const pickerButton = document.querySelector('#avatar-picker')
const save = document.querySelector('#avatar-save')
const forget = document.querySelector('#avatar-forget')
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
let savedAvatar = false
let checkedStorage = false

function updateActions() {
  actions.hidden = !selectedAvatar
  show.disabled = presenceBusy || presenceOpen
  hide.disabled = presenceBusy || !presenceOpen
  save.disabled = presenceBusy || picker.disabled
  forget.disabled = presenceBusy || picker.disabled || !savedAvatar
  monitor.disabled = presenceBusy || !presenceOpen || monitor.options.length === 0
  for (const command of commands)
    command.disabled = presenceBusy || !presenceOpen
}

async function preview(bytes) {
  const { createAvatarView } = await import('./avatar-view.js')
  view ??= createAvatarView(canvas)
  await view.load(bytes)
  selectedAvatar = bytes
  canvas.hidden = false
  status.textContent = t('Avatar carregado.')
}

async function changeSavedAvatar(operation, message) {
  presenceBusy = true
  updateActions()
  try {
    await operation()
    if (message)
      status.textContent = t(message)
  }
  catch {
    status.textContent = t('Não foi possível acessar o avatar salvo.')
  }
  finally {
    presenceBusy = false
    updateActions()
    releaseClosedPreview()
  }
}

save.addEventListener('click', () => void changeSavedAvatar(async () => {
  await saveAvatar(selectedAvatar)
  savedAvatar = true
}, 'Avatar salvo neste perfil.'))
forget.addEventListener('click', () => {
  if (window.confirm(t('Remover o avatar salvo deste perfil?'))) {
    void changeSavedAvatar(async () => {
      await removeSavedAvatar()
      savedAvatar = false
    }, 'Avatar removido deste perfil.')
  }
})

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
    const bytes = await file.arrayBuffer()
    if (/\.zip$/i.test(file.name)) {
      const extracted = await window.liaStagePresence.readPackagedAvatar(new Uint8Array(bytes))
      if (extracted === 'live2d-unavailable') {
        status.textContent = t('Este cartão usa Live2D. O Stage atual aceita avatares VRM.')
        return
      }
      if (!extracted)
        throw new Error('avatar-package')
      await preview(extracted.buffer)
    }
    else {
      await preview(bytes)
    }
  }
  catch {
    status.textContent = t('Não foi possível abrir este avatar. Escolha um arquivo VRM com recursos incorporados.')
  }
  finally {
    picker.value = ''
    picker.disabled = false
    pickerButton.disabled = false
    updateActions()
    releaseClosedPreview()
  }
})

details.addEventListener('toggle', () => {
  releaseClosedPreview()
  if (details.open && selectedAvatar && !view && !presenceBusy && !picker.disabled) {
    void changeSavedAvatar(() => preview(selectedAvatar), '')
    return
  }
  if (details.open && !checkedStorage) {
    checkedStorage = true
    pickerButton.disabled = true
    void changeSavedAvatar(async () => {
      try {
        const bytes = await readSavedAvatar()
        if (bytes) {
          savedAvatar = true
          await preview(bytes)
        }
      }
      finally {
        pickerButton.disabled = false
      }
    }, '')
  }
})
window.addEventListener('pagehide', () => view?.dispose(), { once: true })
