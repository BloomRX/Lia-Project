import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, open, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { _electron } from 'playwright'

assert.equal(process.platform, 'win32')
assert.equal(process.argv.length, 6, 'Informe whisper-server.exe, ggml-tiny.bin, jfk.wav e porta local.')
const [engine, model, fixture] = process.argv.slice(2, 5).map(path => resolve(path))
const port = Number(process.argv[5])
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535)
const address = `http://127.0.0.1:${port}/v1`
const root = await mkdtemp(join(tmpdir(), 'lia-whisper-cpu-'))
console.log(`Evidências em ${root}`)
const ready = () => fetch(address + '/', { signal: AbortSignal.timeout(500) }).then(response => response.ok).catch(() => false)
assert.equal(await ready(), false, 'A porta está em uso.')
const log = await open(join(root, 'server.log'), 'wx')
const start = performance.now()
const server = spawn(engine, [
  '-m', model, '--host', '127.0.0.1', '--port', String(port), '--request-path', '/v1',
  '--inference-path', '/audio/transcriptions', '--convert', '-ng', '-l', 'en', '-t', '4',
], { cwd: root, windowsHide: true, stdio: ['ignore', log.fd, log.fd] })
let app
try {
  await once(server, 'spawn')
  await log.close()
  let listening = false
  while (!listening && server.exitCode === null && performance.now() - start < 15000) {
    listening = await ready()
    if (!listening)
      await delay(100)
  }
  assert.ok(listening && server.exitCode === null, 'O servidor de transcrição está indisponível.')
  const serverStartupMs = Math.round(performance.now() - start)
  await mkdir(join(root, 'appdata'))
  const stageRoot = fileURLToPath(new URL('../../stage/', import.meta.url))
  const launch = {
    executablePath: join(stageRoot, 'node_modules', 'electron', 'dist', 'electron.exe'),
    env: { ...process.env, APPDATA: join(root, 'appdata'), LIA_USER_DATA: root, LIA_STAGE_PROFILE_DIR: join(root, 'stage') },
  }
  app = await _electron.launch({ ...launch, args: [fileURLToPath(new URL('../out/main/index.js', import.meta.url))] })
  const launcher = await app.firstWindow()
  await launcher.getByRole('button', { name: 'Voz', exact: true }).click()
  await launcher.getByText('Reconhecimento de fala compatível com OpenAI', { exact: true }).click()
  await launcher.getByLabel('Onde transcrever').selectOption({ label: 'Servidor neste computador' })
  await launcher.getByLabel('Endereço da API de transcrição').fill(address)
  await launcher.getByLabel('Modelo de transcrição').fill('ggml-tiny')
  await launcher.getByRole('button', { name: 'Salvar reconhecimento' }).click()
  await launcher.getByText('Reconhecimento de fala selecionado.', { exact: true }).waitFor()
  await app.close()
  app = undefined

  app = await _electron.launch({ ...launch, args: [
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${fixture}%noloop`,
    join(stageRoot, 'out', 'main', 'index.js'),
  ] })
  const stage = await app.firstWindow()
  await stage.getByRole('button', { name: 'Gravar mensagem', exact: true }).click()
  await stage.getByText('Gravando…', { exact: true }).waitFor()
  // A amostra oficial tem 11 segundos de fala.
  await delay(11500)
  const begin = performance.now()
  await stage.getByRole('button', { name: 'Parar e transcrever' }).click()
  await stage.getByText('Transcrição inserida. Revise antes de enviar.', { exact: true }).waitFor({ timeout: 30000 })
  const transcriptionMs = Math.round(performance.now() - begin)
  const transcript = await stage.getByLabel('Mensagem', { exact: true }).inputValue()
  const normalized = transcript.replace(/\s+/g, ' ')
  assert.match(normalized, /your country can do for you/i)
  assert.match(normalized, /you can do for your country/i)
  await stage.screenshot({ path: join(root, 'stage.png'), fullPage: true })
  const report = { backend: 'CPU', fixtureDurationSeconds: 11, serverStartupMs, transcriptionMs, transcript, configuredByLauncher: true, draftInserted: true }
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
}
finally {
  try {
    await app?.close()
  }
  finally {
    await log.close()
    if (server.pid && server.exitCode === null) {
      const exited = once(server, 'exit')
      server.kill()
      await exited
    }
  }
}
