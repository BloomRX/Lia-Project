import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { _electron } from 'playwright'
import { createLiaSecretVault } from '@lia/core/secrets/vault'
import { createWindowsUserCipher } from '@lia/core/secrets/windows-user-cipher'

import { bindCredential, credentialForDestination } from '../../core/src/credentials/destination.ts'
import { createRuntimeRegistry, invokeRuntimeControl } from '../../core/src/runtime/index.ts'

async function waitForRecord(registry) {
  const deadline = Date.now() + 10_000
  do {
    const entry = await registry.read()
    if (entry.ok)
      return entry.record
    await delay(100)
  } while (Date.now() < deadline)
  throw new Error('O Stage próprio não publicou seu registro.')
}

async function waitForProcessExit(pid) {
  const deadline = Date.now() + 10_000
  do {
    try {
      process.kill(pid, 0)
    }
    catch (error) {
      if (error.code === 'ESRCH')
        return
      throw error
    }
    await delay(100)
  } while (Date.now() < deadline)
  throw new Error('O processo Main do Stage continuou ativo após encerrar a conversa.')
}

const execute = promisify(execFile)

async function listPackagedProcesses(directory) {
  const { stdout } = await execute('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    'Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($env:LIA_GATE_EXE_PREFIX, [StringComparison]::OrdinalIgnoreCase) } | Select-Object -ExpandProperty Id',
  ], { windowsHide: true, timeout: 10_000, env: { ...process.env, LIA_GATE_EXE_PREFIX: directory + sep } })
  return stdout.trim().split(/\s+/).filter(Boolean).map(Number)
}

async function checkPackagedProcessesExited(directory) {
  const deadline = Date.now() + 10_000
  let remaining
  do {
    remaining = await listPackagedProcesses(directory)
    if (remaining.length === 0)
      return
    await delay(100)
  } while (Date.now() < deadline)
  throw new Error(`Processos do pacote Lia continuam ativos: ${remaining.join(', ')}.`)
}

async function checkUpgradeProfile(executablePath, root, env) {
  const stageProfile = join(root, 'native-stage-profile')
  const stage = await _electron.launch({
    executablePath: join(dirname(executablePath), 'resources', 'stage', 'LiaStage.exe'),
    env: { ...env, LIA_STAGE_PROFILE_DIR: stageProfile },
  })
  try {
    const page = await stage.firstWindow()
    await page.getByText('Você: Histórico anterior à atualização', { exact: true }).waitFor({ timeout: 10_000 })
    await page.getByText('Lia: Resposta anterior à atualização', { exact: true }).waitFor({ timeout: 10_000 })
  }
  finally {
    await stage.close()
  }
}

let conversationServer

async function startInstalledConversation(modelId, localPort) {
  const message = localPort ? 'Quanto é 17 + 26? Responda somente com o número, sem pontuação.' : 'Mensagem do gate de instalação'
  const reply = localPort ? '43' : 'Resposta do serviço local'
  let confirmedRequests = 0
  const server = localPort ? undefined : createServer(async (request, response) => {
    try {
      const chunks = []
      for await (const chunk of request)
        chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      assert.equal(request.method, 'POST')
      assert.equal(request.url, '/v1/chat/completions')
      assert.equal(body.model, modelId)
      assert.equal(body.messages.at(-1).content, message)
      confirmedRequests++
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ choices: [{ message: { content: reply } }] }))
    }
    catch {
      response.writeHead(400).end()
    }
  })
  if (server) {
    conversationServer = server
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
  }
  return {
    port: server?.address().port ?? localPort,
    async verify(stagePid) {
      const driver = fileURLToPath(new URL('./check-stage-window-chat.ps1', import.meta.url))
      await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', driver], {
        windowsHide: true,
        timeout: localPort ? 75_000 : 25_000,
        env: {
          ...process.env,
          LIA_UIA_STAGE_PID: String(stagePid),
          LIA_UIA_MESSAGE: message,
          LIA_UIA_REPLY: `Lia: ${reply}`,
          LIA_UIA_REPLY_SECONDS: localPort ? '60' : '10',
        },
      })
    },
    async verifyDirect(executablePath, env) {
      const stage = await _electron.launch({
        executablePath: join(dirname(executablePath), 'resources', 'stage', 'LiaStage.exe'),
        env,
      })
      try {
        const page = await stage.firstWindow()
        await page.getByLabel('Mensagem', { exact: true }).fill(message, { timeout: 10_000 })
        await page.getByRole('button', { name: 'Enviar', exact: true }).click({ timeout: 10_000 })
        await page.getByText(`Lia: ${reply}`, { exact: true }).waitFor({ timeout: localPort ? 60_000 : 10_000 })
      }
      finally {
        await stage.close()
      }
    },
    confirmRequest() {
      if (server)
        assert.equal(confirmedRequests, 1)
    },
  }
}

async function run() {
  assert.equal(process.platform, 'win32', 'Este gate usa o Electron para Windows.')
  const liaRoot = fileURLToPath(new URL('../../', import.meta.url))
  const airiDirectoryAbsent = !existsSync(join(liaRoot, '..', 'airi'))
  if (process.argv.includes('--require-independent'))
    assert.ok(airiDirectoryAbsent, 'Execute o gate em uma árvore que contém apenas lia/.')

  const upgradeArgument = process.argv.find(argument => argument.startsWith('--upgrade-profile='))
  const upgradeProfile = upgradeArgument?.slice('--upgrade-profile='.length)
  const restore = process.argv.includes('--restore-upgrade-profile')
  assert.ok(!upgradeArgument || (upgradeProfile && isAbsolute(upgradeProfile)), 'Informe um caminho absoluto para o perfil de atualização.')
  assert.ok(!restore || upgradeProfile, 'Informe o perfil criado no ensaio da versão anterior.')
  const root = upgradeProfile ?? await mkdtemp(join(tmpdir(), 'lia-native-stage-'))
  const profile = join(root, 'appdata')
  if (upgradeProfile && !restore)
    await mkdir(root)
  if (!restore)
    await mkdir(profile)
  const providerId = 'local-chat'
  const portArgument = process.argv.find(argument => argument.startsWith('--local-port='))
  const modelArgument = process.argv.find(argument => argument.startsWith('--local-model='))
  const localPort = portArgument ? Number(portArgument.slice('--local-port='.length)) : undefined
  const localModel = modelArgument?.slice('--local-model='.length)
  assert.ok(!portArgument || (Number.isInteger(localPort) && localPort > 0 && localPort <= 65_535
    && localModel && /^[\w.:-]{1,128}$/.test(localModel)
    && process.argv.some(argument => argument.startsWith('--installed-executable=')) && !upgradeProfile),
  'Informe porta e modelo locais válidos para o ensaio de instalação limpa.')
  assert.ok(!modelArgument || portArgument, 'Informe a porta do serviço local.')
  const modelId = localModel ?? 'local-gate'
  const installedConversation = !upgradeProfile && process.argv.some(argument => argument.startsWith('--installed-executable='))
  const directStageConversation = process.argv.includes('--direct-stage-conversation')
  assert.ok(!directStageConversation || installedConversation, 'A conversa direta exige uma instalação limpa.')
  const conversation = installedConversation ? await startInstalledConversation(modelId, localPort) : undefined
  const product = JSON.stringify({
    setup: { completed: true },
    provider: { chat: { preferred: { providerId, modelId } } },
  })
  const transports = JSON.stringify({
    schemaVersion: 1,
    revision: 1,
    records: [{
      id: providerId,
      providerId,
      definitionId: providerId,
      type: 'http',
      protocol: 'chat-completions',
      baseUrl: `http://127.0.0.1:${conversation?.port ?? 1234}/v1`,
      modelIds: [modelId],
      adapterOptions: { localOnly: true, allowUnauthenticated: true },
      enabled: true,
      metadata: {},
      credentialRef: { scope: providerId, key: 'apiKey' },
    }],
    tombstones: [],
    migration: { version: 1, imported: [] },
  })
  const historical = JSON.stringify({
    version: 1,
    enabled: true,
    turns: [{
      route: 'a'.repeat(64), reusable: true,
      user: 'Histórico anterior à atualização', assistant: 'Resposta anterior à atualização',
    }],
  })
  const fixtures = [
    ['lia-product.json', product],
    ['lia-transports.json', transports],
  ]
  if (upgradeProfile) {
    if (!restore)
      await mkdir(join(root, 'native-stage-profile'))
    fixtures.push(['native-stage-profile/lia-chat-history.json', historical])
  }
  const baseline = join(root, 'upgrade-baseline.json')
  const upgradeFiles = [...fixtures.map(([name]) => name), 'lia-secrets.json']
  const captureHashes = () => Promise.all(upgradeFiles.map(async name => ({
    name,
    sha256: createHash('sha256').update(await readFile(join(root, name))).digest('hex'),
  })))
  if (restore)
    assert.deepEqual(await captureHashes(), JSON.parse(await readFile(baseline, 'utf8')), 'O perfil mudou durante a substituição.')
  else
    for (const [name, contents] of fixtures)
      await writeFile(join(root, name), contents, { flag: 'wx' })
  const registry = createRuntimeRegistry(join(root, 'runtime', 'native-preview'))
  const installedArgument = process.argv.find(argument => argument.startsWith('--installed-executable='))
  const installedExecutable = installedArgument?.slice('--installed-executable='.length)
  if (installedArgument)
    assert.ok(installedExecutable && isAbsolute(installedExecutable), 'Informe o caminho absoluto do Launcher instalado.')
  assert.ok(!upgradeProfile || installedExecutable, 'O ensaio de atualização exige um Launcher instalado.')
  const packaged = process.argv.includes('--packaged') || installedExecutable !== undefined
  const executablePath = installedExecutable ?? (packaged
    ? join(liaRoot, 'desktop', 'dist', 'windows-native-preview', 'win-unpacked', 'Lia.exe')
    : join(liaRoot, 'stage', 'node_modules', 'electron', 'dist', 'electron.exe'))
  const packageDirectory = dirname(executablePath)
  if (packaged)
    assert.deepEqual(await listPackagedProcesses(packageDirectory), [], 'Feche a instância já aberta deste pacote antes do gate.')
  const env = { ...process.env, APPDATA: profile, LIA_USER_DATA: root }
  const app = await _electron.launch({
    executablePath,
    args: packaged ? [] : [join(liaRoot, 'desktop', 'out', 'main', 'index.js')],
    env,
  })
  let target
  let nativeWindows
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Conversar com Lia', exact: true }).click({ timeout: 10_000 })
    target = await waitForRecord(registry)
    const state = await invokeRuntimeControl(target, 'runtime.status')
    assert.equal(state.windows, 1)
    nativeWindows = state.windows
    if (packaged) {
      const stageProcesses = await listPackagedProcesses(join(packageDirectory, 'resources', 'stage'))
      assert.ok(stageProcesses.includes(target.pid), 'O processo do Stage não pertence ao pacote sob teste.')
      assert.ok(stageProcesses.some(pid => pid !== target.pid), 'A verificação não encontrou processos filhos do Stage empacotado.')
    }
    if (!directStageConversation)
      await conversation?.verify(target.pid)
    await page.getByRole('button', { name: 'Encerrar conversa', exact: true }).click({ timeout: 10_000 })
    await page.getByText('Conversa encerrada.', { exact: true }).waitFor({ timeout: 20_000 })
    assert.deepEqual(await registry.read(), { ok: false, problem: 'missing' })
    await waitForProcessExit(target.pid)
  }
  finally {
    try {
      const remaining = await registry.read()
      if (remaining.ok && (!target || remaining.record.instanceId === target.instanceId))
        await invokeRuntimeControl(remaining.record, 'runtime.shutdown').catch(() => {})
    }
    finally {
      await app.close()
    }
  }
  if (directStageConversation) {
    await conversation.verifyDirect(executablePath, {
      ...env, LIA_STAGE_PROFILE_DIR: join(root, 'native-stage-profile'),
    })
  }
  conversation?.confirmRequest()
  if (packaged)
    await checkPackagedProcessesExited(packageDirectory)
  const conversationSource = installedConversation ? (localPort ? 'operator-loopback' : 'synthetic-loopback') : null
  const lifecycle = { conversationSource, conversationThroughLauncher: installedConversation && !directStageConversation, packageProcessesExited: packaged ? true : null, installedConversation, airiDirectoryAbsent, packaged, installed: Boolean(installedExecutable), nativeWindows, registryRemoved: true, stageMainExited: true }
  if (!upgradeProfile)
    await writeFile(join(root, 'report.json'), JSON.stringify(lifecycle, null, 2), { flag: 'wx' })
  console.log(JSON.stringify(lifecycle))
  if (upgradeProfile) {
    const endpoint = new URL('https://speech-upgrade.example.invalid/v1')
    const scope = 'openai-compatible-audio-speech'
    const synthetic = 'lia-upgrade-synthetic-key'
    const filePath = join(root, 'lia-secrets.json')
    const legacyCipher = () => { throw new Error('Unexpected legacy cipher') }
    const vault = createLiaSecretVault({
      filePath, cipher: createWindowsUserCipher({ available: () => false, encrypt: legacyCipher, decrypt: legacyCipher }),
    })
    if (!restore)
      assert.ok(await vault.setSecret(scope, 'apiKey', bindCredential(scope, endpoint, synthetic, 'speech')))
    assert.ok(!(await readFile(filePath, 'utf8')).includes(synthetic), 'A credencial sintética está em texto claro.')
    assert.ok(credentialForDestination(vault.getSecret(scope, 'apiKey'), scope, endpoint, 'speech') === synthetic, 'Não foi possível recuperar a credencial vinculada.')
    await checkUpgradeProfile(executablePath, root, env)
    await checkPackagedProcessesExited(packageDirectory)
    if (!restore)
      await writeFile(baseline, JSON.stringify(await captureHashes()), { flag: 'wx' })
    console.log(JSON.stringify({ phase: restore ? 'after-upgrade' : 'before-upgrade', settingsPreserved: restore ? true : null, historyVisible: true, credentialRecovered: true }))
  }
}

try {
  await run()
}
finally {
  conversationServer?.close()
}
