import process from 'node:process'

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import launcherConfiguration from '../electron-builder.config.ts'

const launcherRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const ELECTRON_VERSION = '43.4.1'

function requireFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile())
    throw new Error(`${label} ausente: ${path}`)
}

export function packagingInputs(root = launcherRoot) {
  const stage = resolve(root, '../stage')
  return {
    launcher: root,
    stage,
    icon: resolve(root, '../assets/icons/IconAppCompact.png'),
    builder: join(root, 'node_modules/electron-builder/cli.js'),
    electron: join(stage, 'node_modules/electron/dist'),
    stageOutput: join(stage, 'dist/lia-windows/win-unpacked'),
  }
}

/** Packaging consumes completed builds; never installs dependencies or rebuilds concurrently. */
export function validateInputs(inputs, { internalTest = false } = {}) {
  if (!internalTest)
    throw new Error('Distribuição pública bloqueada: licenças de produto e assets pendentes. Use --internal-test somente para validação privada.')
  requireFile(inputs.builder, 'electron-builder instalado')
  requireFile(inputs.icon, 'Ícone da Lia')
  for (const app of [inputs.launcher, inputs.stage]) {
    requireFile(join(app, 'out/main/index.js'), 'Build Main')
    requireFile(join(app, 'out/renderer/index.html'), 'Build Renderer')
    requireFile(join(app, 'package.json'), 'Manifesto do aplicativo')
  }
  requireFile(join(inputs.launcher, 'out/preload/index.cjs'), 'Build Preload do Launcher')
  requireFile(join(inputs.stage, 'out/preload/index.cjs'), 'Build Preload do Stage')
  requireFile(join(inputs.launcher, 'scripts/DISTRIBUTION-NOTICE.txt'), 'Aviso de distribuição interna')
  requireFile(join(inputs.launcher, 'scripts/AIRI-MIT.txt'), 'Atribuição MIT do código histórico')
  const runtimePackage = JSON.parse(readFileSync(join(inputs.electron, '../package.json'), 'utf8'))
  if (runtimePackage.version !== ELECTRON_VERSION)
    throw new Error(`Runtime esperado: Electron ${ELECTRON_VERSION}; encontrado: ${runtimePackage.version}`)
  for (const file of ['electron.exe', 'icudtl.dat', 'LICENSE', 'LICENSES.chromium.html'])
    requireFile(join(inputs.electron, file), 'Runtime Electron Windows e suas licenças')
}

export function stageConfiguration(inputs) {
  return {
    extends: null,
    appId: 'ai.lia.stage',
    productName: 'Lia Stage',
    electronVersion: ELECTRON_VERSION,
    electronDist: inputs.electron,
    directories: { output: resolve(inputs.stage, 'dist/lia-windows') },
    files: ['out/**', 'resources/**', 'package.json', '!**/node_modules/electron{,/**}', '!**/.env{,.*}'],
    asar: true,
    asarUnpack: ['**/*.node'],
    npmRebuild: false,
    publish: null,
    extraResources: [],
    extraMetadata: {
      name: 'lia-stage',
      main: 'out/main/index.js',
      repository: null,
      homepage: null,
    },
    win: { executableName: 'LiaStage', icon: inputs.icon, publish: null },
  }
}

export function nativeLauncherConfiguration(inputs) {
  return {
    ...launcherConfiguration,
    win: { ...launcherConfiguration.win, icon: inputs.icon },
    extraResources: launcherConfiguration.extraResources.map(resource =>
      resource.to === 'stage' ? { ...resource, from: inputs.stageOutput } : resource),
  }
}

export function validatePackagedStage(stageOutput, electronDirectory) {
  // electron-builder renames the official runtime notice while branding the exe.
  for (const file of ['LiaStage.exe', 'resources/app.asar', 'icudtl.dat', 'LICENSE.electron.txt', 'LICENSES.chromium.html', 'version'])
    requireFile(join(stageOutput, file), 'Stage empacotado')
  if (!electronDirectory)
    throw new Error('Origem oficial do runtime obrigatória para validar o Stage.')
  for (const [packaged, original] of [['LICENSE.electron.txt', 'LICENSE'], ['LICENSES.chromium.html', 'LICENSES.chromium.html']]) {
    const source = join(electronDirectory, original)
    requireFile(source, 'Licença oficial do runtime')
    const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex')
    if (digest(join(stageOutput, packaged)) !== digest(source))
      throw new Error(`Licença do runtime divergente: ${packaged}`)
  }
  if (readFileSync(join(stageOutput, 'version'), 'utf8').trim() !== ELECTRON_VERSION)
    throw new Error('Versão do runtime empacotado divergente.')
  assertNoUpdateFeed(stageOutput)
}

function assertNoUpdateFeed(output) {
  if (existsSync(join(output, 'resources/app-update.yml')))
    throw new Error('O pacote contém um canal de atualização não autorizado.')
}

export function validatePackagedLauncher(output) {
  assertNoUpdateFeed(output)
  assertNoUpdateFeed(join(output, 'resources/stage'))
}

export function validateArchiveEntries(entries) {
  for (const entry of entries) {
    const parts = entry.toLowerCase().split(/[\\/]+/)
    if (parts.some(part => part === 'airi' || part === '@proj-airi'
      || part.startsWith('cubismsdkforweb')
      || /^live2dcubismcore(?:\.min)?\.js$/.test(part)
      || /^hiyori_(?:free|pro).*\.zip$/.test(part))) {
      throw new Error('O pacote contém runtime ou assets legados fora do escopo da distribuição privada.')
    }
  }
}

function validateArchive(builderPath, archive) {
  requireFile(archive, 'Arquivo do aplicativo')
  // Use the ASAR reader of the same pinned builder that wrote the archive.
  const builderRequire = createRequire(realpathSync(builderPath))
  const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib'))
  const { listPackage } = appBuilderRequire('@electron/asar')
  validateArchiveEntries(listPackage(archive))
}

function builder(inputs, cwd, args) {
  const result = spawnSync(process.execPath, [inputs.builder, ...args, '--publish', 'never'], {
    cwd,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  })
  if (result.error)
    throw result.error
  if (result.status !== 0)
    throw new Error(`electron-builder falhou (código ${result.status ?? 'indisponível'}).`)
}

export function packageWindows({ checkOnly = false, unpacked = false, internalTest = false } = {}) {
  const inputs = packagingInputs()
  validateInputs(inputs, { internalTest })
  if (checkOnly) {
    process.stdout.write('Pré-requisitos de empacotamento disponíveis. Instalador e licenças de assets ainda exigem validação.\n')
    return
  }
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error('Execute o empacotamento em Windows x64 com os builds Launcher e Stage concluídos.')
  const temporary = mkdtempSync(join(tmpdir(), 'lia-package-'))
  try {
    const config = join(temporary, 'stage.json')
    writeFileSync(config, JSON.stringify(stageConfiguration(inputs), null, 2))
    builder(inputs, inputs.stage, ['--config', config, '--win', '--x64', '--dir'])
    validatePackagedStage(inputs.stageOutput, inputs.electron)
    validateArchive(inputs.builder, join(inputs.stageOutput, 'resources/app.asar'))
    const launcherConfig = join(temporary, 'launcher.json')
    writeFileSync(launcherConfig, JSON.stringify(nativeLauncherConfiguration(inputs), null, 2))
    builder(inputs, inputs.launcher, [
      '--config',
      launcherConfig,
      `--config.electronDist=${inputs.electron}`,
      '--win',
      '--x64',
      ...(unpacked ? ['--dir'] : []),
    ])
    const output = resolve(inputs.launcher, launcherConfiguration.directories.output, 'win-unpacked')
    validatePackagedLauncher(output)
    validateArchive(inputs.builder, join(output, 'resources/app.asar'))
    validateArchive(inputs.builder, join(output, 'resources/stage/resources/app.asar'))
  }
  finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  try {
    if (args.some(arg => !['--check', '--dir', '--internal-test', '--native'].includes(arg)))
      throw new Error('Uso: node scripts/package-windows.mjs --internal-test [--check] [--dir]')
    packageWindows({ checkOnly: args.includes('--check'), unpacked: args.includes('--dir'), internalTest: args.includes('--internal-test') })
  }
  catch (error) {
    // Standalone Node packaging must not depend on workspace TypeScript helpers.
    // eslint-disable-next-line no-restricted-syntax
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
