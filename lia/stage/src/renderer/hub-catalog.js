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
