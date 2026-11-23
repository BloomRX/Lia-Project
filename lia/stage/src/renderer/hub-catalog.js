import { t } from './locale.js'

const button = document.querySelector('#hub-refresh')
const list = document.querySelector('#hub-capabilities')
const status = document.querySelector('#hub-status')

button.addEventListener('click', async () => {
  button.disabled = true
  status.textContent = t('Consultando o catálogo…')
  try {
    const result = await window.liaStageHub.catalog()
    list.replaceChildren()
    if (result.status !== 'ready') {
      status.textContent = t(result.status === 'missing' ? 'O Lia Agent Hub ainda não publicou um catálogo neste perfil.' : 'Não foi possível ler o catálogo do Lia Agent Hub.')
      return
    }
    for (const capability of result.capabilities) {
      const row = document.createElement('li')
      row.textContent = `${capability.name} · ${capability.type}`
      list.append(row)
    }
    status.textContent = result.capabilities.length ? '' : t('Nenhuma capacidade ativa publicada.')
  }
  catch {
    list.replaceChildren()
    status.textContent = t('Não foi possível ler o catálogo do Lia Agent Hub.')
  }
  finally {
    button.disabled = false
  }
})
