import process from 'node:process'

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const launcherRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const ELECTRON_VERSION = '43.4.1'

function requireFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile())
    throw new Error(`${label} ausente: ${path}`)
}

export function packagingInputs(root = launcherRoot) {
  const stage = resolve(root, '../stage-tamagotchi')
  return {
    launcher: root,
    stage,
    builder: join(stage, 'node_modules/electron-builder/cli.js'),
    electron: join(stage, 'node_modules/electron/dist'),
    stageOutput: join(stage, 'dist/lia-windows/win-unpacked'),
  }
}

/** Packaging consumes completed builds; never installs dependencies or rebuilds concurrently. */
export function validateInputs(inputs, { internalTest = false } = {}) {
  if (!internalTest)
    throw new Error('Distribuição pública bloqueada: licenças de produto e assets pendentes. Use --internal-test somente para validação privada.')
  requireFile(inputs.builder, 'electron-builder instalado')
  for (const app of [inputs.launcher, inputs.stage]) {
    requireFile(join(app, 'out/main/index.js'), 'Build Main')
    requireFile(join(app, 'out/renderer/index.html'), 'Build Renderer')
    requireFile(join(app, 'package.json'), 'Manifesto do aplicativo')
  }
  requireFile(join(inputs.launcher, 'out/preload/index.cjs'), 'Build Preload do Launcher')
  requireFile(join(inputs.stage, 'out/preload/index.mjs'), 'Build Preload do Stage')
  requireFile(resolve(inputs.launcher, '../../LICENSE'), 'Licença do Stage')
  requireFile(join(inputs.launcher, 'scripts/DISTRIBUTION-NOTICE.txt'), 'Aviso de distribuição interna')
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
    win: { executableName: 'LiaStage', publish: null },
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
  if (existsSync(join(stageOutput, 'resources/app-update.yml')))
    throw new Error('Stage contém um canal de atualização não autorizado. Revise a configuração antes de distribuir.')
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
    builder(inputs, inputs.launcher, [
      '--config',
      join(inputs.launcher, 'electron-builder.config.ts'),
      `--config.electronDist=${inputs.electron}`,
      '--win',
      '--x64',
      ...(unpacked ? ['--dir'] : []),
    ])
  }
  finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  if (args.some(arg => !['--check', '--dir', '--internal-test'].includes(arg)))
    throw new Error('Uso: node scripts/package-windows.mjs --internal-test [--check] [--dir]')
  try {
    packageWindows({ checkOnly: args.includes('--check'), unpacked: args.includes('--dir'), internalTest: args.includes('--internal-test') })
  }
  catch (error) {
    // Standalone Node packaging must not depend on workspace TypeScript helpers.
    // eslint-disable-next-line no-restricted-syntax
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
