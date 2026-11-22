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
let audioUrl
let answerVersion = 0

function clearAudio() {
  audio.pause()
  audio.removeAttribute('src')
  audio.hidden = true
  if (audioUrl)
    URL.revokeObjectURL(audioUrl)
  audioUrl = undefined
}

const errors = {
  busy: 'Há uma mensagem em andamento.',
  cancelled: 'Envio cancelado.',
  configuration: 'Selecione e confira a conexão de IA no Launcher.',
  invalid: 'Digite uma mensagem válida.',
  unavailable: 'A IA não respondeu. Verifique o serviço e tente novamente.',
}

function appendMessage(author, text) {
  const entry = document.createElement('p')
  entry.className = 'message'
  entry.textContent = `${author}: ${text}`
  messages.append(entry)
  messages.scrollTop = messages.scrollHeight
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const text = message.value.trim()
  if (send.disabled || !text)
    return

  send.disabled = true
  cancel.disabled = false
  message.readOnly = true
  status.textContent = 'Aguardando resposta da Lia…'
  try {
    const result = await window.liaStageChat.send(text)
    if (!result.ok) {
      status.textContent = errors[result.code] ?? errors.unavailable
      return
    }
    appendMessage('Você', text)
    appendMessage('Lia', result.text)
    answerVersion++
    clearAudio()
    voice.hidden = false
    voiceStatus.textContent = ''
    message.value = ''
    status.textContent = ''
  }
  catch {
    status.textContent = errors.unavailable
  }
  finally {
    message.readOnly = false
    send.disabled = false
    cancel.disabled = true
    message.focus()
  }
})

speak.addEventListener('click', async () => {
  const version = answerVersion
  speak.disabled = true
  clearAudio()
  voiceStatus.textContent = 'Preparando a resposta em áudio…'
  try {
    const result = await window.liaStageChat.speak()
    if (version !== answerVersion)
      return
    if (!result.ok) {
      voiceStatus.textContent = result.code === 'disabled'
        ? 'A saída de voz está desativada.'
        : 'A voz selecionada está indisponível.'
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
      voiceStatus.textContent = 'Não foi possível preparar a resposta em áudio.'
  }
  finally {
    speak.disabled = false
  }
})

window.addEventListener('pagehide', clearAudio)

cancel.addEventListener('click', async () => {
  cancel.disabled = true
  try {
    await window.liaStageChat.cancel()
  }
  catch {
    status.textContent = errors.unavailable
  }
})
