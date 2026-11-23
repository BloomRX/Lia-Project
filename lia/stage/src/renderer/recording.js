const record = document.querySelector('#record')
const cancel = document.querySelector('#record-cancel')
const status = document.querySelector('#record-status')
const draft = document.querySelector('#message')
const mimeType = 'audio/webm;codecs=opus'
let current

function release(job) {
  clearTimeout(job.timer)
  job.stream?.getTracks().forEach(track => track.stop())
}

function finish(job, message) {
  release(job)
  if (current !== job)
    return
  current = undefined
  record.textContent = 'Gravar mensagem'
  record.disabled = false
  cancel.disabled = true
  status.textContent = message
}

function discard() {
  const job = current
  if (!job)
    return
  if (job.recorder?.state === 'recording')
    job.recorder.stop()
  finish(job, 'Gravação cancelada.')
  void window.liaStageChat.cancelTranscription().catch(() => {})
}

record.addEventListener('click', async () => {
  if (current?.recorder?.state === 'recording') {
    current.recorder.stop()
    return
  }
  if (current)
    return
  const job = { chunks: [], size: 0 }
  current = job
  record.disabled = true
  cancel.disabled = false
  status.textContent = 'Aguardando acesso ao microfone…'

  try {
    if (!MediaRecorder.isTypeSupported(mimeType) || !await window.liaStageChat.armMicrophone())
      throw new Error('Microphone unavailable')
    if (current !== job)
      return
    job.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    if (current !== job) {
      release(job)
      return
    }
    const recorder = new MediaRecorder(job.stream, { mimeType })
    job.recorder = recorder
    recorder.addEventListener('dataavailable', ({ data }) => {
      if (current !== job)
        return
      job.size += data.size
      if (job.size <= 24 * 1024 * 1024)
        job.chunks.push(data)
      else
        discard()
    })
    recorder.addEventListener('error', () => finish(job, 'Não foi possível gravar a mensagem.'))
    recorder.addEventListener('stop', async () => {
      release(job)
      if (current !== job)
        return
      record.disabled = true
      status.textContent = 'Transcrevendo a gravação…'
      try {
        const bytes = new Uint8Array(await new Blob(job.chunks).arrayBuffer())
        if (current !== job)
          return
        const result = await window.liaStageChat.transcribe(bytes, mimeType)
        if (current !== job)
          return
        if (!result.ok || !result.text.trim()) {
          finish(job, result.code === 'cancelled'
            ? 'Transcrição cancelada.'
            : 'Não foi possível transcrever. Confira a configuração de transcrição.')
          return
        }
        const text = [draft.value.trim(), result.text.trim()].filter(Boolean).join(' ')
        if (text.length > draft.maxLength) {
          finish(job, 'A transcrição excede o limite da mensagem.')
          return
        }
        draft.value = text
        finish(job, 'Transcrição inserida. Revise antes de enviar.')
        draft.focus()
      }
      catch {
        finish(job, 'Não foi possível transcrever a gravação.')
      }
    }, { once: true })
    recorder.start(500)
    job.timer = setTimeout(() => {
      if (recorder.state === 'recording')
        recorder.stop()
    }, 60_000)
    record.textContent = 'Parar e transcrever'
    record.disabled = false
    status.textContent = 'Gravando…'
  }
  catch {
    finish(job, 'Não foi possível acessar o microfone.')
  }
})

cancel.addEventListener('click', discard)
window.addEventListener('pagehide', discard)
