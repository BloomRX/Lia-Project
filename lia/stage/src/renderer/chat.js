const form = document.querySelector('form')
const message = document.querySelector('#message')
const send = document.querySelector('button[type="submit"]')
const cancel = document.querySelector('#cancel')
const messages = document.querySelector('#messages')
const status = document.querySelector('#status')

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

cancel.addEventListener('click', async () => {
  cancel.disabled = true
  try {
    await window.liaStageChat.cancel()
  }
  catch {
    status.textContent = errors.unavailable
  }
})
