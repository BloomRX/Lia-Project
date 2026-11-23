import { maxStageImageBytes } from '../shared/chat-image.ts'

import { t } from './locale.js'

const form = document.querySelector('form')
const message = document.querySelector('#message')
const send = document.querySelector('button[type="submit"]')
const cancel = document.querySelector('#cancel')
const messages = document.querySelector('#messages')
const status = document.querySelector('#status')
const voice = document.querySelector('#voice')
const speak = document.querySelector('#speak')
const audio = document.querySelector('audio')
const voiceStatus = document.querySelector('#voice-status')
const historyEnabled = document.querySelector('#history-enabled')
const historyClear = document.querySelector('#history-clear')
const historyStatus = document.querySelector('#history-status')
const imagePick = document.querySelector('#image-pick')
const imageRemove = document.querySelector('#image-remove')
const imageFile = document.querySelector('#image-file')
const imageStatus = document.querySelector('#image-status')
let audioUrl
let answerVersion = 0
let attachment
let cancelRequested = false

function clearAttachment() {
  attachment = undefined
  imageFile.value = ''
  imageRemove.hidden = true
  imageStatus.textContent = ''
}

imagePick.addEventListener('click', () => imageFile.click())
imageRemove.addEventListener('click', clearAttachment)
imageFile.addEventListener('change', () => {
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
})

function clearAudio() {
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
  'rate-limit': t('A conexão de IA atingiu seu limite de uso. Aguarde e tente novamente.'),
  timeout: t('A IA demorou para responder. Tente novamente.'),
  unavailable: t('A IA não respondeu. Verifique o serviço e tente novamente.'),
}

function appendMessage(author, text) {
  const entry = document.createElement('p')
  entry.className = 'message'
  entry.textContent = `${author}: ${text}`
  messages.append(entry)
  messages.scrollTop = messages.scrollHeight
}

async function changeHistory(action) {
  historyEnabled.disabled = true
  historyClear.disabled = true
  try {
    if (!await window.liaStageChat.changeHistory(action))
      throw new Error('history')
    if (action !== 'enable') {
      messages.replaceChildren()
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
    historyClear.disabled = false
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
  if (window.confirm(t('Apagar as mensagens desta conversa?')))
    void changeHistory('clear')
})

send.disabled = true
try {
  const history = await window.liaStageChat.history()
  if (!history)
    throw new Error('history')
  for (const turn of history.turns) {
    appendMessage(t('Você'), turn.user)
    appendMessage('Lia', turn.assistant)
  }
  historyEnabled.checked = history.enabled
  historyEnabled.disabled = false
  historyClear.disabled = false
}
catch {
  historyStatus.textContent = t('Não foi possível recuperar o histórico.')
}
finally {
  send.disabled = false
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const text = message.value.trim()
  if (send.disabled || !text)
    return

  send.disabled = true
  cancelRequested = false
  cancel.disabled = false
  message.readOnly = true
  imagePick.disabled = true
  imageRemove.disabled = true
  status.textContent = t('Aguardando resposta da Lia…')
  try {
    const bytes = attachment && new Uint8Array(await attachment.arrayBuffer())
    if (cancelRequested) {
      status.textContent = errors.cancelled
      return
    }
    const result = await window.liaStageChat.send(text, bytes)
    if (!result.ok) {
      status.textContent = errors[result.code] ?? errors.unavailable
      return
    }
    appendMessage(t('Você'), text)
    appendMessage('Lia', result.text)
    answerVersion++
    clearAudio()
    voice.hidden = false
    voiceStatus.textContent = ''
    message.value = ''
    clearAttachment()
    status.textContent = result.historyUnavailable ? t('Resposta recebida. Não foi possível salvar o histórico.') : ''
  }
  catch {
    status.textContent = errors.unavailable
  }
  finally {
    message.readOnly = false
    send.disabled = false
    cancel.disabled = true
    imagePick.disabled = false
    imageRemove.disabled = false
    message.focus()
  }
})

speak.addEventListener('click', async () => {
  const version = answerVersion
  speak.disabled = true
  clearAudio()
  voiceStatus.textContent = t('Preparando a resposta em áudio…')
  try {
    const result = await window.liaStageChat.speak()
    if (version !== answerVersion)
      return
    if (!result.ok) {
      voiceStatus.textContent = result.code === 'disabled'
        ? t('A saída de voz está desativada.')
        : t('A voz selecionada está indisponível.')
      return
    }
    audioUrl = URL.createObjectURL(new Blob([result.audio], { type: 'audio/wav' }))
    audio.src = audioUrl
    audio.hidden = false
    voiceStatus.textContent = ''
    await audio.play().catch(() => {})
  }
  catch {
    if (version === answerVersion)
      voiceStatus.textContent = t('Não foi possível preparar a resposta em áudio.')
  }
  finally {
    speak.disabled = false
  }
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
