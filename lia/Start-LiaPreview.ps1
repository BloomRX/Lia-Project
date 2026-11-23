param([switch]$PrepareOnly)

$ErrorActionPreference = 'Stop'

function Invoke-LiaPnpm {
  & corepack pnpm @args
  if ($LASTEXITCODE -ne 0) {
    throw "O comando pnpm falhou com código $LASTEXITCODE."
  }
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw 'Esta entrada da Lia é para Windows.'
}
if (!(Get-Command corepack -ErrorAction SilentlyContinue)) {
  throw 'Instale o Node.js e prepare o Corepack antes de abrir a Lia.'
}

$stage = Join-Path $PSScriptRoot 'stage'
$launcher = Join-Path $PSScriptRoot 'desktop'
Push-Location -LiteralPath $stage
try {
  Write-Output 'Preparando o Stage próprio da Lia…'
  Invoke-LiaPnpm install --frozen-lockfile --ignore-scripts
  Invoke-LiaPnpm run build
  Invoke-LiaPnpm exec install-electron
}
finally {
  Pop-Location
}

Push-Location -LiteralPath $launcher
try {
  Write-Output 'Preparando o Launcher…'
  Invoke-LiaPnpm install --frozen-lockfile --ignore-scripts
  Invoke-LiaPnpm run build
}
finally {
  Pop-Location
}

if ($PrepareOnly) {
  return
}

$electron = Join-Path $stage 'node_modules\electron\dist\electron.exe'
$entry = Join-Path $launcher 'out\main\index.js'
if (!(Test-Path -LiteralPath $electron -PathType Leaf) -or !(Test-Path -LiteralPath $entry -PathType Leaf)) {
  throw 'O Electron ou o Launcher compilado não está disponível.'
}
$process = Start-Process -FilePath $electron -ArgumentList ('"{0}"' -f $entry) -WorkingDirectory $launcher -Wait -PassThru
exit $process.ExitCode
