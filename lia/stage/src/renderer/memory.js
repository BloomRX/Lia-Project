import { t } from './locale.js'

const memory = window.liaStageMemory
const controls = document.querySelector('#memory-controls')
const enabled = document.querySelector('#memory-enabled')
const note = document.querySelector('#memory-note')
const save = document.querySelector('#memory-save')
const clear = document.querySelector('#memory-clear')
const entries = document.querySelector('#memory-entries')
const status = document.querySelector('#memory-status')
const scope = document.querySelector('#memory-scope')
const project = scope.querySelector('[value="project"]')
let conversationId
const kind = document.querySelector('#memory-kind')
const classification = document.querySelector('#memory-classification')
const expires = document.querySelector('#memory-expires')
const cancelEdit = document.querySelector('#memory-cancel-edit')
const exportNotes = document.querySelector('#memory-export')
let current
let editingId

function resetEditor() {
  editingId = undefined
  note.value = ''
  scope.value = project.disabled ? 'global' : 'conversation'
  scope.disabled = false
  kind.value = 'user'
  classification.value = 'fact'
  expires.value = ''
  cancelEdit.hidden = true
}

function render(state) {
  current = state
  enabled.checked = state.enabled
  clear.disabled = state.entries.length === 0
  exportNotes.disabled = clear.disabled
  if (editingId && !state.entries.some(entry => entry.id === editingId))
    resetEditor()
  entries.replaceChildren()
  for (const entry of state.entries) {
    const row = document.createElement('li')
    const text = document.createElement('span')
    text.textContent = entry.text
    const label = document.createElement('small')
    label.textContent = t(entry.scope?.kind === 'project' ? 'Projeto atual' : entry.scope?.kind === 'conversation' ? 'Conversa atual' : 'Global')
    const edit = document.createElement('button')
    edit.type = 'button'
    edit.textContent = t('Editar nota')
    edit.addEventListener('click', () => {
      editingId = entry.id
      note.value = entry.text
      scope.value = entry.scope?.kind ?? 'global'
      scope.disabled = true
      kind.value = entry.metadata?.kind ?? 'user'
      classification.value = entry.metadata?.classification ?? 'fact'
      expires.value = entry.metadata?.expiresAt?.slice(0, 10) ?? ''
      cancelEdit.hidden = false
      note.focus()
    })
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.textContent = t('Remover')
    remove.addEventListener('click', async () => {
      if (window.confirm(t('Remover esta nota?'))) {
        await run(() => memory.mutate({ action: 'remove', id: entry.id }, undefined, conversationId), t('Nota removida.'))
        note.focus()
      }
    })
    row.append(text, ' · ', label, ' ', edit, ' ', remove)
    entries.append(row)
  }
}

async function run(operation, success = '') {
  const context = conversationId
  controls.disabled = true
  status.textContent = t('Aguarde…')
  try {
    const result = await operation()
    if (context !== conversationId)
      return false
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
    if (context === conversationId)
      controls.disabled = false
  }
}

enabled.addEventListener('change', () => {
  void run(() => memory.mutate({ action: 'enable', enabled: enabled.checked }, undefined, conversationId), t('Preferência salva.'))
})
save.addEventListener('click', async () => {
  const text = note.value.trim()
  if (!text) {
    status.textContent = t('Escreva uma nota para salvar.')
    note.focus()
    return
  }
  const metadata = {
    kind: kind.value,
    classification: classification.value,
    expiresAt: expires.value ? `${expires.value}T23:59:59.999Z` : null,
  }
  if (await run(() => memory.mutate({ action: 'save', id: editingId, text, metadata }, editingId ? undefined : scope.value, conversationId), t('Nota salva.')))
    resetEditor()
  note.focus()
})

cancelEdit.addEventListener('click', () => {
  resetEditor()
  note.focus()
})

exportNotes.addEventListener('click', async () => {
  controls.disabled = true
  try {
    const result = await memory.exportNotes()
    status.textContent = result.ok ? t('Notas exportadas.')
      : result.code === 'cancelled' ? '' : t('Não foi possível exportar. Escolha um arquivo novo.')
  }
  catch {
    status.textContent = t('Não foi possível exportar. Escolha um arquivo novo.')
  }
  finally {
    controls.disabled = false
    exportNotes.focus()
  }
})

clear.addEventListener('click', async () => {
  const cleared = await run(() => memory.mutate({ action: 'clear', confirmed: true }), t('Notas apagadas.'))
  if (cleared)
    note.focus()
  else
    clear.focus()
})

export function setMemoryContext(detail) {
  if (detail.conversationId === conversationId)
    return
  conversationId = detail.conversationId
  project.disabled = !detail.hasProject
  current = undefined
  entries.replaceChildren()
  resetEditor()
  void run(() => memory.get())
}
