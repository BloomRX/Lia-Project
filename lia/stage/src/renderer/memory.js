import { t } from './locale.js'

const memory = window.liaStageMemory
const controls = document.querySelector('#memory-controls')
const enabled = document.querySelector('#memory-enabled')
const note = document.querySelector('#memory-note')
const save = document.querySelector('#memory-save')
const clear = document.querySelector('#memory-clear')
const entries = document.querySelector('#memory-entries')
const status = document.querySelector('#memory-status')
let current

function render(state) {
  current = state
  enabled.checked = state.enabled
  clear.disabled = state.entries.length === 0
  entries.replaceChildren()
  for (const entry of state.entries) {
    const row = document.createElement('li')
    const text = document.createElement('span')
    text.textContent = entry.text
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.textContent = t('Remover')
    remove.addEventListener('click', async () => {
      if (window.confirm(t('Remover esta nota?'))) {
        await run(() => memory.mutate({ action: 'remove', id: entry.id }), t('Nota removida.'))
        note.focus()
      }
    })
    row.append(text, ' ', remove)
    entries.append(row)
  }
}

async function run(operation, success = '') {
  controls.disabled = true
  status.textContent = t('Aguarde…')
  try {
    const result = await operation()
    if (result.code === 'cancelled') {
      status.textContent = ''
      return false
    }
    if (!result.ok)
      throw new Error('memory')
    render(result.value)
    status.textContent = success
    return true
  }
  catch {
    if (current)
      enabled.checked = current.enabled
    status.textContent = t('Não foi possível acessar ou alterar a memória. Tente novamente após o envio da mensagem.')
    return false
  }
  finally {
    controls.disabled = false
  }
}

enabled.addEventListener('change', () => {
  void run(() => memory.mutate({ action: 'enable', enabled: enabled.checked }), t('Preferência salva.'))
})
save.addEventListener('click', async () => {
  const text = note.value.trim()
  if (!text) {
    status.textContent = t('Escreva uma nota para salvar.')
    note.focus()
    return
  }
  if (await run(() => memory.mutate({ action: 'save', text }), t('Nota salva.')))
    note.value = ''
  note.focus()
})

clear.addEventListener('click', async () => {
  const cleared = await run(() => memory.mutate({ action: 'clear', confirmed: true }), t('Notas apagadas.'))
  if (cleared)
    note.focus()
  else
    clear.focus()
})

void run(() => memory.get())
