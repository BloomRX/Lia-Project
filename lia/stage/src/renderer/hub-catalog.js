import { t } from './locale.js'

const button = document.querySelector('#hub-refresh')
const list = document.querySelector('#hub-capabilities')
const status = document.querySelector('#hub-status')

const search = document.querySelector('#hub-search')
let capabilities = []

function render() {
  list.replaceChildren()
  const query = search.value.trim().toLowerCase()
  const matches = capabilities.filter(({ id, name, type }) =>
    `${name} ${type} ${id}`.toLowerCase().includes(query))
  for (const capability of matches) {
    const row = document.createElement('li')
    const details = document.createElement('details')
    const summary = document.createElement('summary')
    summary.textContent = `${capability.name} · ${capability.type}`
    const identifier = document.createElement('p')
    identifier.textContent = `${t('Identificador da capacidade')} · ${capability.id}`
    details.append(summary, identifier)
    row.append(details)
    list.append(row)
  }
  status.textContent = capabilities.length === 0 ? t('Nenhuma capacidade ativa publicada.')
    : matches.length === 0 ? t('Nenhuma capacidade corresponde ao filtro.') : ''
}

search.addEventListener('input', render)
button.addEventListener('click', async () => {
  button.disabled = true
  search.disabled = true
  status.textContent = t('Consultando o catálogo…')
  try {
    const result = await window.liaStageHub.catalog()
    list.replaceChildren()
    if (result.status !== 'ready') {
      status.textContent = t(result.status === 'missing' ? 'O Lia Agent Hub ainda não publicou um catálogo neste perfil.' : 'Não foi possível ler o catálogo do Lia Agent Hub.')
      return
    }
    capabilities = result.capabilities
    search.disabled = capabilities.length === 0
    render()
  }
  catch {
    list.replaceChildren()
    status.textContent = t('Não foi possível ler o catálogo do Lia Agent Hub.')
  }
  finally {
    button.disabled = false
  }
})

const skill = window.liaStageHub
const skillText = document.querySelector('#hub-skill-text')
const validate = document.querySelector('#hub-skill-run')
const cancel = document.querySelector('#hub-skill-cancel')
const audit = document.querySelector('#hub-skill-audit')
const skillStatus = document.querySelector('#hub-skill-status')
const events = document.querySelector('#hub-skill-events')
const states = {
  queued: 'Validação na fila.',
  running: 'Validação em andamento.',
  completed: 'Validação estrutural concluída.',
  failed: 'A validação falhou.',
  cancelled: 'Validação cancelada.',
}

function showTask(task) {
  if (!task)
    return
  audit.disabled = task.state === 'queued' || task.state === 'running'
  const message = t(states[task.state])
  skillStatus.textContent = task.counts
    ? `${message} ${t('Erros')}: ${task.counts.error} · ${t('Avisos')}: ${task.counts.warning} · ${t('Informações')}: ${task.counts.info} · ${t('Revisões')}: ${task.counts.review}`
    : message
}

validate.addEventListener('click', async () => {
  const selection = skillText.value.slice(skillText.selectionStart, skillText.selectionEnd)
  if (!selection.trim()) {
    skillStatus.textContent = t('Selecione o texto da Skill antes de validar.')
    skillText.focus()
    return
  }
  validate.disabled = true
  skillText.readOnly = true
  cancel.disabled = false
  audit.disabled = true
  events.replaceChildren()
  skillStatus.textContent = t('Aguardando confirmação ou resposta do Hub.')
  let done = false
  let timer
  async function poll() {
    const state = await skill.skillStatus().catch(() => undefined)
    if (!done) {
      showTask(state?.task)
      timer = setTimeout(poll, 800)
    }
  }
  timer = setTimeout(poll, 800)
  try {
    const queued = await skill.validateSkill(selection)
    if (queued.ok)
      showTask(queued.value)
    const result = queued.ok && !cancel.disabled && queued.value.state === 'queued'
      ? await skill.startSkill()
      : queued
    if (result.ok) {
      const current = await skill.skillStatus()
      showTask(current?.task ?? result.value)
    }
    else {
      if (result.code === 'declined')
        skillStatus.textContent = t('Validação cancelada.')
      else if (result.code === 'forbidden' || result.code === 'unauthorized')
        skillStatus.textContent = t('Autorização do operador indisponível ou recusada.')
      else if (result.code === 'invalid-request')
        skillStatus.textContent = t('Selecione até 65.536 bytes de texto da Skill.')
      else
        skillStatus.textContent = t('O Hub está indisponível.')
    }
  }
  catch { skillStatus.textContent = t('O Hub está indisponível.') }
  finally {
    done = true
    clearTimeout(timer)
    validate.disabled = false
    skillText.readOnly = false
    cancel.disabled = true
  }
})

cancel.addEventListener('click', async () => {
  cancel.disabled = true
  try {
    const result = await skill.cancelSkill()
    if (!result?.ok)
      throw new Error('cancel-unavailable')
    const current = await skill.skillStatus()
    showTask(current?.task)
  }
  catch {
    skillStatus.textContent = t('O Hub está indisponível.')
    cancel.disabled = false
  }
})

audit.addEventListener('click', async () => {
  audit.disabled = true
  try {
    const result = await skill.skillAudit()
    if (!result.ok)
      throw new Error('audit-unavailable')
    events.replaceChildren(...result.value.map(({ sequence, state, at, code }) => {
      const row = document.createElement('li')
      row.textContent = `${sequence} · ${new Date(at * 1000).toLocaleString()} · ${t(states[state])}${code ? ` · ${code}` : ''}`
      return row
    }))
  }
  catch { skillStatus.textContent = t('O Hub está indisponível.') }
  finally { audit.disabled = false }
})
