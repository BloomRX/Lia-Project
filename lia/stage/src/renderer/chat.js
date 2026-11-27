import { maxStageImageBytes } from '../shared/chat-image.ts'

import { createExpressionState } from './expression-state.ts'
import { t } from './locale.js'
import { setMemoryContext } from './memory.js'

const form = document.querySelector('form')
const message = document.querySelector('#message')
const allowClock = document.querySelector('#allow-clock')
const suggestClock = document.querySelector('#suggest-clock')
const send = document.querySelector('button[type="submit"]')
const cancel = document.querySelector('#cancel')
const messages = document.querySelector('#messages')
const status = document.querySelector('#status')
const voice = document.querySelector('#voice')
const speak = document.querySelector('#speak')
const speakStop = document.querySelector('#speak-stop')
const audio = document.querySelector('audio')
const voiceStatus = document.querySelector('#voice-status')
const expressionStatus = document.querySelector('#expression-status')
const expressionLabels = {
  idle: 'Em repouso',
  thinking: 'Em foco',
  responded: 'Resposta pronta',
  speaking: 'Reproduzindo resposta',
}
const renderExpression = ({ phase }) => {
  window.liaStagePresence.publishExpression(phase)
  expressionStatus.dataset.phase = phase
  expressionStatus.textContent = t(expressionLabels[phase])
}
const expression = createExpressionState({ onChange: renderExpression })
renderExpression(expression.snapshot())
audio.addEventListener('playing', () => expression.setPlayback(!audio.paused && Boolean(audio.src)))
for (const event of ['pause', 'ended', 'emptied'])
  audio.addEventListener(event, () => expression.setPlayback(!audio.paused && !audio.ended && Boolean(audio.src)))
window.addEventListener('pagehide', () => expression.dispose(), { once: true })
const voiceAutoPlay = document.querySelector('#voice-autoplay')
const voiceAutoPlayStatus = document.querySelector('#voice-autoplay-status')
const historyEnabled = document.querySelector('#history-enabled')
const historyClear = document.querySelector('#history-clear')
const historyStatus = document.querySelector('#history-status')
const historyImport = document.querySelector('#history-import')
const historyImportFile = document.querySelector('#history-import-file')
const conversation = document.querySelector('#conversation')
const projectName = document.querySelector('#conversation-project-name')
const newProject = document.querySelector('#conversation-project')
const newConversation = document.querySelector('#conversation-add')
const deleteConversation = document.querySelector('#conversation-delete')
const record = document.querySelector('#record')
const recordCancel = document.querySelector('#record-cancel')
const imagePick = document.querySelector('#image-pick')
const imageCopy = document.querySelector('#image-copy')
const imageCopyCancel = document.querySelector('#image-copy-cancel')
const imageCopyAudit = document.querySelector('#image-copy-audit')
const imageInfo = document.querySelector('#image-info')
const imageRemove = document.querySelector('#image-remove')
const imageFile = document.querySelector('#image-file')
const imageStatus = document.querySelector('#image-status')
let audioUrl
let answerVersion = 0
let copyingImage = false
let imageCopyCancelled = false
let attachment
let cancelRequested = false
let activeConversation
let unsavedMessages = false

async function loadVoiceAutoPlay() {
  try {
    const value = await window.liaStageChat.autoPlay()
    if (typeof value !== 'boolean')
      throw new Error('autoplay')
    voiceAutoPlay.checked = value
    voiceAutoPlay.disabled = false
  }
  catch {
    voiceAutoPlayStatus.textContent = t('Não foi possível carregar a leitura automática.')
  }
}

voiceAutoPlay.addEventListener('change', async () => {
  const requested = voiceAutoPlay.checked
  voiceAutoPlay.checked = !requested
  voiceAutoPlay.disabled = true
  try {
    if (await window.liaStageChat.autoPlay(requested) !== requested)
      throw new Error('autoplay')
    voiceAutoPlay.checked = requested
    voiceAutoPlayStatus.textContent = t('Preferência de leitura salva.')
  }
  catch {
    voiceAutoPlayStatus.textContent = t('Não foi possível salvar a leitura automática.')
  }
  finally {
    voiceAutoPlay.disabled = false
  }
})
void loadVoiceAutoPlay()

function clearAttachment() {
  attachment = undefined
  imageFile.value = ''
  imageRemove.hidden = true
  imageCopy.hidden = true
  imageInfo.textContent = ''
  imageStatus.textContent = ''
}

imagePick.addEventListener('click', () => imageFile.click())
imageRemove.addEventListener('click', clearAttachment)
imageFile.addEventListener('change', async () => {
  const image = imageFile.files[0]
  if (!image)
    return
  clearAttachment()
  if (!['image/png', 'image/jpeg'].includes(image.type) || !image.size || image.size > maxStageImageBytes) {
    imageStatus.textContent = t('Escolha uma imagem PNG ou JPEG de até 3 MB.')
    return
  }
  attachment = image
  imageRemove.hidden = false
  imageStatus.textContent = t('Imagem anexada. Será enviada com a mensagem.')
  const metadata = await image.arrayBuffer().then(bytes => window.liaStageImage.inspect(new Uint8Array(bytes))).catch(() => undefined)
  if (attachment !== image || !metadata)
    return
  imageInfo.textContent = `${metadata.format.toUpperCase()} · ${metadata.width} × ${metadata.height} px`
  imageCopy.hidden = false
})

const copyMessages = {
  saved: 'Cópia verificada e salva.',
  cancelled: 'Cópia cancelada.',
  exists: 'O arquivo já existe. Escolha outro nome.',
  invalid: 'Não foi possível salvar a cópia.',
  unavailable: 'Não foi possível salvar a cópia.',
}
imageCopy.addEventListener('click', async () => {
  const image = attachment
  if (!image || copyingImage || send.disabled)
    return
  copyingImage = true
  imageCopyCancelled = false
  imageCopy.disabled = true
  imagePick.disabled = true
  imageRemove.disabled = true
  imageCopyCancel.hidden = false
  try {
    const bytes = new Uint8Array(await image.arrayBuffer())
    const result = imageCopyCancelled ? { ok: false, code: 'cancelled' } : await window.liaStageImage.copy(bytes)
    imageStatus.textContent = t(copyMessages[result.ok ? 'saved' : result.code] ?? copyMessages.unavailable)
    const audit = await window.liaStageImage.audit()
    imageCopyAudit.replaceChildren(...audit.map(({ at, outcome }) => {
      const row = document.createElement('li')
      row.textContent = `${new Date(at).toLocaleTimeString()} · ${t(copyMessages[outcome] ?? copyMessages.unavailable)}`
      return row
    }))
  }
  catch {
    imageStatus.textContent = t(copyMessages.unavailable)
  }
  finally {
    copyingImage = false
    imageCopy.disabled = false
    imagePick.disabled = false
    imageRemove.disabled = false
    imageCopyCancel.hidden = true
    imageCopy.focus()
  }
})
imageCopyCancel.addEventListener('click', () => {
  imageCopyCancelled = true
  void window.liaStageImage.cancel().catch(() => {})
})

function clearAudio() {
  speakStop.disabled = true
  audio.pause()
  audio.removeAttribute('src')
  audio.hidden = true
  if (audioUrl)
    URL.revokeObjectURL(audioUrl)
  audioUrl = undefined
}

const errors = {
  busy: t('Há uma mensagem em andamento.'),
  cancelled: t('Envio cancelado.'),
  configuration: t('Selecione e confira a conexão de IA no Launcher.'),
  credentials: t('A conexão de IA recusou a credencial. Confira a configuração no Launcher.'),
  invalid: t('Digite uma mensagem válida.'),
  'image-invalid': t('Escolha uma imagem PNG ou JPEG de até 3 MB.'),
  'image-unavailable': t('A conexão selecionada não tem uma rota de visão disponível.'),
  'persona-unavailable': t('Este cartão não está disponível para esta conexão. Use IA local ou selecione a personalidade padrão.'),
  'capability-suggested': t('Plano sugerido. Marque a consulta e envie a mensagem. Se confirmar, a Lia poderá consultar o relógio deste computador e usar o resultado na resposta.'),
  'tool-unavailable': t('A consulta de data e hora está disponível em mensagens de texto com IA local compatível.'),
  'rate-limit': t('A conexão de IA atingiu seu limite de uso. Aguarde e tente novamente.'),
  timeout: t('A IA demorou para responder. Tente novamente.'),
  unavailable: t('A IA não respondeu. Verifique o serviço e tente novamente.'),
}

function appendMessage(author, text, container = messages, saved) {
  const entry = document.createElement('p')
  entry.className = 'message'
  const label = document.createElement('span')
  label.textContent = `${author}: ${text}`
  entry.append(label)
  if (saved) {
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'message-remove'
    remove.textContent = t('Apagar mensagem')
    remove.setAttribute('aria-label', `${t('Apagar mensagem')} — ${author}: ${text.slice(0, 60)}`)
    remove.addEventListener('click', async () => {
      if (send.disabled || historyEnabled.disabled || unsavedMessages)
        return
      historyEnabled.disabled = true
      send.disabled = true
      updateClearAction()
      try {
        const result = await window.liaStageChat.removeSavedMessage(saved.id, saved.revision, saved.index, saved.side)
        if (result?.status === 'cancelled')
          return
        if (result?.status !== 'removed')
          throw new Error('history-remove')
        showConversation(result.state)
        answerVersion++
        clearAudio()
        voice.hidden = true
        status.textContent = t('Mensagem apagada.')
        message.focus()
      }
      catch {
        status.textContent = t('Não foi possível apagar esta mensagem.')
      }
      finally {
        historyEnabled.disabled = false
        send.disabled = false
        updateClearAction()
        if (remove.isConnected)
          remove.focus()
      }
    })
    entry.append(' ', remove)
  }
  container.append(entry)
  if (container === messages)
    messages.scrollTop = messages.scrollHeight
}

function updateClearAction() {
  const blocked = !activeConversation || historyEnabled.disabled || send.disabled
  historyClear.disabled = blocked || !messages.childElementCount
  for (const remove of messages.querySelectorAll('.message-remove'))
    remove.disabled = blocked || unsavedMessages
}

function showConversation(state) {
  activeConversation = state.activeId
  conversation.replaceChildren(...state.conversations.map(({ id, title, projectName }, index) =>
    new Option((projectName ? `${projectName} · ` : '') + (title || `${t('Conversa')} ${index + 1}`), id)))
  conversation.value = activeConversation
  setMemoryContext({ conversationId: state.activeId, hasProject: Boolean(state.projectName) })
  messages.replaceChildren()
  for (const [index, turn] of state.turns.entries()) {
    const saved = { id: state.activeId, revision: state.revision, index }
    if (turn.user)
      appendMessage(t('Você'), turn.user, messages, { ...saved, side: 'user' })
    if (turn.assistant)
      appendMessage('Lia', turn.assistant, messages, { ...saved, side: 'assistant' })
  }
  unsavedMessages = false
  historyEnabled.checked = state.enabled
  historyImport.disabled = !state.enabled
}

async function changeConversation(action, id) {
  conversation.value = activeConversation
  if (send.disabled || historyEnabled.disabled || !recordCancel.disabled || id === activeConversation)
    return
  const prompt = action === 'delete' ? 'Excluir esta conversa e todas as suas mensagens?'
    : (message.value || attachment || unsavedMessages) ? 'Trocar de conversa? O rascunho e as mensagens não guardadas serão descartados.' : undefined
  if (prompt && !window.confirm(t(prompt)))
    return
  const controls = [send, conversation, newConversation, newProject, deleteConversation, historyEnabled, historyClear, record, imagePick, imageRemove]
  controls.forEach(control => { control.disabled = true })
  message.readOnly = true
  historyImport.disabled = true
  try {
    const state = await window.liaStageChat.changeConversation(action, id)
    if (!state)
      throw new Error('conversation')
    showConversation(state)
    message.value = ''
    allowClock.checked = false
    clearAttachment()
    answerVersion++
    clearAudio()
    voice.hidden = true
    status.textContent = ''
    historyStatus.textContent = ''
  }
  catch {
    historyStatus.textContent = t('Não foi possível mudar de conversa. O limite é de 12 conversas.')
  }
  finally {
    controls.forEach(control => { control.disabled = false })
    message.readOnly = false
    historyImport.disabled = !historyEnabled.checked
    updateClearAction()
  }
}

conversation.addEventListener('change', () => void changeConversation('select', conversation.value))
newProject.addEventListener('click', () => {
  const name = projectName.value.trim()
  if (name)
    void changeConversation('create-project', name)
  else
    projectName.focus()
})
newConversation.addEventListener('click', () => void changeConversation('create'))
deleteConversation.addEventListener('click', () => void changeConversation('delete'))

const personaFile = document.querySelector('#persona-file')
const personaImport = document.querySelector('#persona-import')
const personaDefault = document.querySelector('#persona-default')
const personaStatus = document.querySelector('#persona-status')
const traitsFieldset = document.querySelector('#traits-fieldset')
const traitInputs = document.querySelector('#trait-inputs')
const traitContext = document.querySelector('#trait-context')
const traitSave = document.querySelector('#trait-save')
const traitLabels = {
  confidence: 'Confiança', affection: 'Carinho', shyness: 'Timidez', teasing: 'Provocação',
  sarcasm: 'Sarcasmo', humor: 'Humor', curiosity: 'Curiosidade', energy: 'Energia',
  kindness: 'Gentileza', proactivity: 'Proatividade',
}
const contextLabels = { casual: 'Conversa normal', playful: 'Brincadeira', relaxed: 'Relaxada', praise: 'Elogio', serious: 'Assunto sério', helping: 'Usuário precisa de ajuda' }
traitContext.replaceChildren(...Object.entries(contextLabels).map(([key, label]) => new Option(t(label), key)))

function showTraits(state) {
  traitInputs.replaceChildren()
  for (const [key, label] of Object.entries(traitLabels)) {
    const row = document.createElement('div')
    const name = document.createElement('label')
    const input = document.createElement('input')
    input.id = `persona-${key}`
    input.dataset.trait = key
    input.type = 'number'
    input.min = '0'
    input.max = '100'
    input.step = '1'
    input.value = String(Math.round(state.traits.attributes[key] * 100))
    input.required = true
    name.htmlFor = input.id
    name.textContent = t(label)
    row.append(name, ' ', input)
    traitInputs.append(row)
  }
  traitContext.value = state.traits.contextId
  traitsFieldset.disabled = false
}

traitSave.addEventListener('click', () => {
  const inputs = Array.from(traitInputs.querySelectorAll('input'))
  if (inputs.some(input => !input.reportValidity()))
    return
  const attributes = Object.fromEntries(inputs.map(input => [input.dataset.trait, input.valueAsNumber / 100]))
  void selectPersona(null, { attributes, contextId: traitContext.value })
})

personaImport.addEventListener('click', () => personaFile.click())
personaDefault.addEventListener('click', () => void selectPersona(null))
personaFile.addEventListener('change', () => {
  const file = personaFile.files[0]
  personaFile.value = ''
  if (file && window.confirm(t('Usar a personalidade deste cartão nas conversas com IA local?')))
    void selectPersona(file)
})

async function selectPersona(file, traits) {
  if (send.disabled || personaDefault.disabled)
    return
  personaDefault.disabled = true
  personaImport.disabled = true
  traitsFieldset.disabled = true
  send.disabled = true
  try {
    const archive = file && /\.zip$/i.test(file.name)
    if (file && file.size > (archive ? 64 * 1024 * 1024 : 128 * 1024))
      throw new Error('persona')
    const content = archive ? new Uint8Array(await file.arrayBuffer()) : file ? await file.text() : null
    const name = await window.liaStageChat.changePersona(traits ?? content)
    if (!name)
      throw new Error('persona')
    personaStatus.textContent = `${t('Personalidade ativa')}: ${traits ? t('Lia personalizada') : name}`
    const state = await window.liaStageChat.activePersona().catch(() => undefined)
    if (state?.traits)
      showTraits(state)
    answerVersion++
    clearAudio()
    voice.hidden = true
  }
  catch {
    personaStatus.textContent = t(traits ? 'Não foi possível salvar os traços.' : 'Não foi possível selecionar a personalidade. Use um JSON CCv3 de até 128 KB ou um pacote ZIP de até 64 MB.')
  }
  finally {
    personaDefault.disabled = false
    personaImport.disabled = false
    traitsFieldset.disabled = !traitInputs.childElementCount
    send.disabled = false
  }
}

async function changeHistory(action) {
  historyEnabled.disabled = true
  historyClear.disabled = true
  historyImport.disabled = true
  try {
    if (!await window.liaStageChat.changeHistory(action))
      throw new Error('history')
    if (action !== 'enable') {
      messages.replaceChildren()
      unsavedMessages = false
      answerVersion++
      clearAudio()
      voice.hidden = true
    }
    historyStatus.textContent = action === 'enable' ? t('Histórico ativado.') : t('Conversa limpa.')
  }
  catch {
    if (action !== 'clear')
      historyEnabled.checked = action === 'disable'
    historyStatus.textContent = t('Não foi possível alterar o histórico. Tente novamente após o envio.')
  }
  finally {
    historyEnabled.disabled = false
    historyImport.disabled = !historyEnabled.checked
    updateClearAction()
  }
}

historyEnabled.addEventListener('change', () => {
  if (!historyEnabled.checked && !window.confirm(t('Desativar o histórico e apagar a conversa guardada?'))) {
    historyEnabled.checked = true
    return
  }
  void changeHistory(historyEnabled.checked ? 'enable' : 'disable')
})
historyClear.addEventListener('click', () => {
  if (!historyClear.disabled && window.confirm(t('Apagar as mensagens desta conversa?')))
    void changeHistory('clear')
})
historyImport.addEventListener('click', () => historyImportFile.click())
historyImportFile.addEventListener('change', async () => {
  const file = historyImportFile.files[0]
  historyImportFile.value = ''
  if (!file)
    return
  if (file.size > 4 * 1024 * 1024) {
    historyStatus.textContent = t('Escolha uma exportação JSON de até 4 MB.')
    return
  }
  if (!window.confirm(t('Importar as trocas de texto mais recentes deste arquivo? Elas ficam disponíveis para leitura local.')))
    return
  historyImport.disabled = true
  historyEnabled.disabled = true
  historyClear.disabled = true
  try {
    const turns = await window.liaStageChat.importHistory(await file.text())
    if (!turns)
      throw new Error('history-import')
    const imported = document.createDocumentFragment()
    for (const turn of turns) {
      appendMessage(t('Você'), turn.user, imported)
      appendMessage('Lia', turn.assistant, imported)
    }
    messages.prepend(imported)
    if (turns.length && !unsavedMessages) {
      const snapshot = await window.liaStageChat.history().catch(() => undefined)
      if (snapshot)
        showConversation(snapshot)
    }
    historyStatus.textContent = t(turns.length ? 'Conversa legada importada para leitura.' : 'Nenhuma troca nova de texto foi importada.')
  }
  catch {
    historyStatus.textContent = t('Não foi possível importar a conversa.')
  }
  finally {
    historyImport.disabled = !historyEnabled.checked
    historyEnabled.disabled = false
    updateClearAction()
  }
})

send.disabled = true
try {
  const personality = await window.liaStageChat.activePersona().catch(() => undefined)
  if (personality?.name)
    personaStatus.textContent = `${t('Personalidade ativa')}: ${personality.name === 'Lia personalizada' ? t(personality.name) : personality.name}`
  if (personality?.traits)
    showTraits(personality)
  const history = await window.liaStageChat.history()
  if (!history)
    throw new Error('history')
  showConversation(history)
  conversation.disabled = false
  newConversation.disabled = false
  newProject.disabled = false
  deleteConversation.disabled = false
  historyEnabled.disabled = false
}
catch {
  historyStatus.textContent = t('Não foi possível recuperar o histórico.')
}
finally {
  send.disabled = false
  updateClearAction()
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const text = message.value.trim()
  if (send.disabled || copyingImage || !text)
    return

  send.disabled = true
  updateClearAction()
  cancelRequested = false
  const suggestion = event.submitter === suggestClock
  const clockAllowed = allowClock.checked
  allowClock.checked = false
  allowClock.disabled = true
  suggestClock.disabled = true
  cancel.disabled = false
  message.readOnly = true
  imagePick.disabled = true
  imageRemove.disabled = true
  status.textContent = t('Aguardando resposta da Lia…')
  expression.setConversation('thinking')
  let replied = false
  try {
    const bytes = attachment && new Uint8Array(await attachment.arrayBuffer())
    if (cancelRequested) {
      status.textContent = errors.cancelled
      return
    }
    const intent = suggestion ? { capability: 'local-clock', mode: 'suggest' } : clockAllowed
    const result = await window.liaStageChat.send(text, bytes, intent)
    if (!result.ok) {
      status.textContent = errors[result.code] ?? errors.unavailable
      return
    }
    replied = true
    expression.setConversation('responded')
    appendMessage(t('Você'), text)
    appendMessage('Lia', result.text)
    unsavedMessages ||= !historyEnabled.checked || Boolean(attachment) || Boolean(result.historyUnavailable)
    if (!unsavedMessages) {
      const snapshot = await window.liaStageChat.history().catch(() => undefined)
      const latest = snapshot?.turns.at(-1)
      if (latest?.user === text && latest.assistant === result.text)
        showConversation(snapshot)
      else
        unsavedMessages = true
    }
    answerVersion++
    clearAudio()
    voice.hidden = false
    voiceStatus.textContent = ''
    message.value = ''
    clearAttachment()
    status.textContent = result.historyUnavailable ? t('Resposta recebida. Não foi possível salvar o histórico.') : ''
    if (voiceAutoPlay.checked)
      speak.click()
  }
  catch {
    status.textContent = errors.unavailable
  }
  finally {
    if (!replied)
      expression.setConversation('idle')
    message.readOnly = false
    send.disabled = false
    updateClearAction()
    cancel.disabled = true
    allowClock.disabled = false
    suggestClock.disabled = false
    imagePick.disabled = false
    imageRemove.disabled = false
    message.focus()
  }
})

speak.addEventListener('click', async () => {
  const version = answerVersion
  const expressiveRate = expression.snapshot().phase === 'responded' ? 1.03 : 1
  speak.disabled = true
  clearAudio()
  speakStop.disabled = false
  voiceStatus.textContent = t('Preparando a resposta em áudio…')
  try {
    const result = await window.liaStageChat.speak()
    if (version !== answerVersion)
      return
    if (!result.ok) {
      speakStop.disabled = true
      voiceStatus.textContent = result.code === 'disabled'
        ? t('A saída de voz está desativada.')
        : result.code === 'cancelled' ? t('Áudio interrompido.') : t('A voz selecionada está indisponível.')
      return
    }
    audioUrl = URL.createObjectURL(new Blob([result.audio], { type: 'audio/wav' }))
    audio.src = audioUrl
    audio.playbackRate = expressiveRate
    audio.hidden = false
    voiceStatus.textContent = ''
    try {
      await audio.play()
    }
    catch {
      if (version === answerVersion) {
        clearAudio()
        voiceStatus.textContent = t('Não foi possível reproduzir o áudio. Tente novamente.')
      }
    }
  }
  catch {
    if (version === answerVersion) {
      speakStop.disabled = true
      voiceStatus.textContent = t('Não foi possível preparar a resposta em áudio.')
    }
  }
  finally {
    speak.disabled = false
  }
})

speakStop.addEventListener('click', () => {
  answerVersion++
  clearAudio()
  voiceStatus.textContent = t('Áudio interrompido.')
  void window.liaStageChat.stopSpeech().catch(() => {})
})

window.addEventListener('pagehide', clearAudio)

cancel.addEventListener('click', async () => {
  cancelRequested = true
  cancel.disabled = true
  try {
    await window.liaStageChat.cancel()
  }
  catch {
    status.textContent = errors.unavailable
  }
})
