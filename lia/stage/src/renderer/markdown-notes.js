import { t } from './locale.js'

const connect = document.querySelector('#markdown-connect')
const disconnect = document.querySelector('#markdown-disconnect')
const query = document.querySelector('#markdown-query')
const search = document.querySelector('#markdown-search')
const status = document.querySelector('#markdown-status')
const results = document.querySelector('#markdown-results')
let generation = 0
let hasProject = false
let source

function controls(busy) {
  connect.disabled = !hasProject || busy
  disconnect.disabled = !source || busy
  query.disabled = !source || busy
  search.disabled = !source || busy
}

function showHits(hits) {
  results.replaceChildren(...hits.map((hit) => {
    const row = document.createElement('li')
    const origin = document.createElement('p')
    const excerpt = document.createElement('pre')
    origin.textContent = `${hit.path} · ${t('Linhas')} ${hit.lineStart}–${hit.lineEnd} · ${hit.size} B · ${hit.modifiedAt} · SHA-256 ${hit.sha256}`
    origin.style.overflowWrap = 'anywhere'
    excerpt.style.whiteSpace = 'pre-wrap'
    excerpt.style.overflowWrap = 'anywhere'
    excerpt.textContent = hit.excerpt
    row.append(origin, excerpt)
    return row
  }))
}

async function run(action) {
  const observed = generation
  controls(true)
  results.replaceChildren()
  status.textContent = t('Aguarde…')
  try {
    const result = await window.liaStageMemory.markdown(action, action === 'search' ? query.value : undefined)
    if (observed !== generation)
      return
    if (result.status === 'connected')
      source = result.path
    else if (result.status === 'disconnected' || result.status === 'no-project')
      source = undefined
    if (result.status === 'ready') {
      showHits(result.hits)
      status.textContent = result.limited ? t('Busca limitada pelos tetos de leitura.')
        : result.hits.length ? source : t('Nenhum trecho encontrado.')
    }
    else if (['connected', 'disconnected', 'cancelled'].includes(result.status))
      status.textContent = source ?? t('Nenhuma pasta conectada.')
    else
      status.textContent = t('Pasta de notas indisponível.')
  }
  catch {
    if (observed === generation)
      status.textContent = t('Pasta de notas indisponível.')
  }
  finally {
    if (observed === generation)
      controls(false)
  }
}

export function setMarkdownContext(available) {
  generation++
  hasProject = available
  source = undefined
  query.value = ''
  results.replaceChildren()
  controls(false)
  if (available)
    void run('status')
  else
    status.textContent = t('Abra uma conversa de projeto para usar notas Markdown.')
}

connect.addEventListener('click', () => void run('connect'))
disconnect.addEventListener('click', () => void run('disconnect'))
search.addEventListener('click', () => {
  if (query.value.trim())
    void run('search')
  else
    query.focus()
})
