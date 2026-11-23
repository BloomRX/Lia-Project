import { t } from './locale.js'

const record = document.querySelector('#record')
const cancel = document.querySelector('#record-cancel')
const status = document.querySelector('#record-status')
const draft = document.querySelector('#message')
const microphone = document.querySelector('#microphone')
const microphoneStatus = document.querySelector('#microphone-status')
const mimeType = 'audio/webm;codecs=opus'
let current
let listing = 0

async function refreshMicrophones(activeTrack) {
  const version = ++listing
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    if (version !== listing)
      return
    const previous = microphone.value
    const inputs = devices.filter(device => device.kind === 'audioinput' && device.deviceId && device.deviceId !== 'default' && device.deviceId !== 'communications')
    // Chromium may hide the device list even while the selected track is available.
    const activeId = activeTrack?.getSettings().deviceId
    if (activeId && !['default', 'communications'].includes(activeId) && !inputs.some(device => device.deviceId === activeId))
      inputs.push({ deviceId: activeId, label: activeTrack.label })
    if (!inputs.length && microphone.options.length > 1)
      return
    const choices = [
      new Option(t('Microfone padrão'), ''),
      ...inputs.map((device, index) => new Option(device.label || `${t('Microfone')} ${index + 1}`, device.deviceId)),
    ]
    microphone.replaceChildren(...choices)
    microphone.value = choices.some(option => option.value === previous) ? previous : ''
    microphoneStatus.textContent = previous && !microphone.value
      ? t('O microfone selecionado foi desconectado. A próxima gravação usará o padrão.')
      : ''
  }
  catch {
    if (version === listing)
      microphoneStatus.textContent = t('Não foi possível listar os microfones.')
  }
}

void refreshMicrophones()
navigator.mediaDevices?.addEventListener('devicechange', () => void refreshMicrophones())
microphone.addEventListener('change', () => { microphoneStatus.textContent = '' })

function release(job) {
  clearTimeout(job.timer)
  job.stream?.getTracks().forEach(track => track.stop())
}

function finish(job, message) {
  release(job)
  if (current !== job)
    return
  current = undefined
  record.textContent = t('Gravar mensagem')
  record.disabled = false
  cancel.disabled = true
  microphone.disabled = false
  status.textContent = message
}

function discard() {
  const job = current
  if (!job)
    return
  if (job.recorder?.state === 'recording')
    job.recorder.stop()
  finish(job, t('Gravação cancelada.'))
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
  microphone.disabled = true
  const deviceId = microphone.value
  status.textContent = t('Aguardando acesso ao microfone…')

  try {
    if (!MediaRecorder.isTypeSupported(mimeType) || !await window.liaStageChat.armMicrophone())
      throw new Error('Microphone unavailable')
    if (current !== job)
      return
    job.stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true })
    if (current !== job) {
      release(job)
      return
    }
    void refreshMicrophones(job.stream.getAudioTracks()[0])
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
    recorder.addEventListener('error', () => finish(job, t('Não foi possível gravar a mensagem.')))
    recorder.addEventListener('stop', async () => {
      release(job)
      if (current !== job)
        return
      record.disabled = true
      status.textContent = t('Transcrevendo a gravação…')
      try {
        const bytes = new Uint8Array(await new Blob(job.chunks).arrayBuffer())
        if (current !== job)
          return
        const result = await window.liaStageChat.transcribe(bytes, mimeType)
        if (current !== job)
          return
        if (!result.ok || !result.text.trim()) {
          finish(job, result.code === 'cancelled'
            ? t('Transcrição cancelada.')
            : t('Não foi possível transcrever. Confira a configuração de transcrição.'))
          return
        }
        const text = [draft.value.trim(), result.text.trim()].filter(Boolean).join(' ')
        if (text.length > draft.maxLength) {
          finish(job, t('A transcrição excede o limite da mensagem.'))
          return
        }
        draft.value = text
        finish(job, t('Transcrição inserida. Revise antes de enviar.'))
        draft.focus()
      }
      catch {
        finish(job, t('Não foi possível transcrever a gravação.'))
      }
    }, { once: true })
    recorder.start(500)
    job.timer = setTimeout(() => {
      if (recorder.state === 'recording')
        recorder.stop()
    }, 60_000)
    record.textContent = t('Parar e transcrever')
    record.disabled = false
    status.textContent = t('Gravando…')
  }
  catch (error) {
    if (current === job)
      void window.liaStageChat.cancelTranscription().catch(() => {})
    const key = error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError'
      ? 'O microfone solicitado não está disponível.'
      : 'Não foi possível acessar o microfone.'
    finish(job, t(key))
  }
})

cancel.addEventListener('click', discard)
window.addEventListener('pagehide', discard)
