param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [string]$PreviousInstaller,
  [string]$EvidenceRoot = [IO.Path]::GetTempPath(),
  [switch]$RequireIndependent
)

$ErrorActionPreference = 'Stop'

function Get-PreviewRegistration {
  Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -eq 'Lia Preview' }
}

function Invoke-Installer([string]$Package, [string]$Destination) {
  $item = Get-Item -LiteralPath $Package
  if ($item.PSIsContainer -or $item.Name -notmatch '^LiaPreviewSetup-.*-x64\.exe$') {
    throw 'Informe um instalador x64 da prévia da Lia.'
  }
  $process = Start-Process -FilePath $item.FullName -ArgumentList @('/S', "/D=$Destination") -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "A instalação retornou exit code $($process.ExitCode)." }
  (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash
}

if (Get-PreviewRegistration) {
  throw 'Já existe uma instalação da prévia neste usuário. Use um perfil de teste dedicado.'
}

$evidence = Join-Path $EvidenceRoot ('lia-native-install-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $evidence | Out-Null
Write-Output "Evidências em $evidence"
$destination = Join-Path $evidence 'installed'
$launcher = Join-Path $destination 'Lia.exe'
$stageArchive = Join-Path $destination 'resources\stage\resources\app.asar'
$uninstaller = Join-Path $destination 'Uninstall Lia.exe'
$report = [ordered]@{
  install = $false
  replacement = $null
  lifecycle = $false
  uninstall = $false
}

try {
  if ($PreviousInstaller) {
    $report['previousInstallerSha256'] = Invoke-Installer $PreviousInstaller $destination
    $report['previousStageSha256'] = (Get-FileHash -LiteralPath $stageArchive -Algorithm SHA256).Hash
  }
  $report['installerSha256'] = Invoke-Installer $Installer $destination
  if (!(Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'Launcher ausente após a instalação.' }
  $report['install'] = $true
  $report['stageSha256'] = (Get-FileHash -LiteralPath $stageArchive -Algorithm SHA256).Hash
  if ($PreviousInstaller) {
    $report['replacement'] = $report.stageSha256 -ne $report.previousStageSha256
    if (!$report.replacement) { throw 'O Stage instalado não mudou. Confira se os instaladores são de builds distintos.' }
  }
  $gateArguments = @("--installed-executable=$launcher")
  if ($RequireIndependent) { $gateArguments += '--require-independent' }
  & node --experimental-strip-types (Join-Path $PSScriptRoot 'check-native-stage.mjs') @gateArguments
  if ($LASTEXITCODE -ne 0) { throw 'O Launcher instalado falhou no gate de ciclo de vida.' }
  $report['lifecycle'] = $true
}
finally {
  if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
    $process = Start-Process -FilePath $uninstaller -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
    $report['uninstallExitCode'] = $process.ExitCode
    $report['uninstall'] = $process.ExitCode -eq 0 -and !(Test-Path -LiteralPath $launcher) -and !(Get-PreviewRegistration)
  }
  $report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidence 'report.json') -Encoding UTF8
}

if (!$report.uninstall) { throw 'A desinstalação da prévia não foi confirmada.' }
