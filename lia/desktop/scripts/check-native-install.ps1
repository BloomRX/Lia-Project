param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [string]$PreviousInstaller,
  [string]$EvidenceRoot = [IO.Path]::GetTempPath(),
  [ValidateRange(0, 65535)][int]$LocalModelPort = 0,
  [string]$LocalModel,
  [switch]$DirectStageConversation,
  [switch]$RequireAttribution,
  [switch]$RequireIndependent,
  [switch]$RequireBranding
)

$ErrorActionPreference = 'Stop'

function Get-PreviewRegistration {
  Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -eq 'Lia Preview' }
}

function Get-ExecutableIconHash([string]$Path) {
  $icon = [Drawing.Icon]::ExtractAssociatedIcon((Resolve-Path -LiteralPath $Path).Path)
  if (!$icon) { throw "Missing executable icon: $Path" }
  try {
    $bitmap = $icon.ToBitmap()
    try {
      $stream = New-Object IO.MemoryStream
      try {
        $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
        $stream.Position = 0
        (Get-FileHash -InputStream $stream -Algorithm SHA256).Hash
      }
      finally { $stream.Dispose() }
    }
    finally { $bitmap.Dispose() }
  }
  finally { $icon.Dispose() }
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

if (($LocalModelPort -gt 0) -ne [bool]$LocalModel -or ($LocalModel -and ($PreviousInstaller -or $LocalModel -cnotmatch '^[a-zA-Z0-9_.:-]{1,128}$'))) {
  throw 'Informe um modelo e uma porta locais válidos para o ensaio de instalação limpa.'
}

if ($DirectStageConversation -and $PreviousInstaller) { throw 'A conversa direta exige instalação limpa.' }

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
$upgradeProfile = Join-Path $evidence 'profile'
$gateArguments = @("--installed-executable=$launcher")
if ($RequireIndependent) { $gateArguments += '--require-independent' }
if ($DirectStageConversation) { $gateArguments += '--direct-stage-conversation' }
if ($LocalModelPort) { $gateArguments += @("--local-port=$LocalModelPort", "--local-model=$LocalModel") }
$report = [ordered]@{
  install = $false
  attributionSha256 = $null
  replacement = $null
  lifecycle = $false
  installedConversation = $null
  conversationThroughLauncher = $null
  conversationSource = $null
  packageProcessesExited = $null
  profilePreserved = $null
  credentialPreserved = $null
  uninstall = $false
}

try {
  if ($PreviousInstaller) {
    $report['previousInstallerSha256'] = Invoke-Installer $PreviousInstaller $destination
    $report['previousStageSha256'] = (Get-FileHash -LiteralPath $stageArchive -Algorithm SHA256).Hash
    $report['previousVersion'] = (Get-Item -LiteralPath $launcher).VersionInfo.ProductVersion
    $gateArguments += "--upgrade-profile=$upgradeProfile"
    & node --experimental-strip-types (Join-Path $PSScriptRoot 'check-native-stage.mjs') @gateArguments
    if ($LASTEXITCODE -ne 0) { throw 'A versão anterior falhou no ensaio de perfil.' }
    $gateArguments += '--restore-upgrade-profile'
  }
  $report['installerSha256'] = Invoke-Installer $Installer $destination
  if (!(Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'Launcher ausente após a instalação.' }
  $report['install'] = $true
  if ($RequireAttribution) {
    $sourceNotice = Join-Path $PSScriptRoot 'AIRI-MIT.txt'
    $installedNotice = Join-Path $destination 'resources/licenses/AIRI-MIT.txt'
    $expected = (Get-FileHash -LiteralPath $sourceNotice -Algorithm SHA256).Hash
    $actual = (Get-FileHash -LiteralPath $installedNotice -Algorithm SHA256).Hash
    if ($actual -ne $expected) { throw 'O aviso MIT instalado diverge do texto versionado.' }
    $report['attributionSha256'] = $actual
    $runtime = Join-Path $PSScriptRoot '../../stage/node_modules/electron/dist'
    $notices = @{ 'LICENSE.electron.txt' = 'LICENSE'; 'LICENSES.chromium.html' = 'LICENSES.chromium.html' }
    foreach ($name in $notices.Keys) {
      $expected = (Get-FileHash -LiteralPath (Join-Path $runtime $notices[$name]) -Algorithm SHA256).Hash
      foreach ($payload in @($destination, (Join-Path $destination 'resources/stage'))) {
        $installed = (Get-FileHash -LiteralPath (Join-Path $payload $name) -Algorithm SHA256).Hash
        if ($installed -ne $expected) { throw "O aviso instalado diverge do runtime oficial: $name" }
      }
    }
    $report['runtimeNoticesVerified'] = $true
  }
  if ($RequireBranding) {
    Add-Type -AssemblyName System.Drawing
    $reference = Join-Path $PSScriptRoot '../../stage/node_modules/electron/dist/electron.exe'
    $launcherIcon = Get-ExecutableIconHash $launcher
    $stageIcon = Get-ExecutableIconHash (Join-Path $destination 'resources/stage/LiaStage.exe')
    $installerIcon = Get-ExecutableIconHash $Installer
    if ($launcherIcon -eq (Get-ExecutableIconHash $reference) -or $stageIcon -ne $launcherIcon -or $installerIcon -ne $launcherIcon) {
      throw 'Installer, Launcher and Stage must share a product icon distinct from Electron.'
    }
    $report['productIconSha256'] = $launcherIcon
  }
  $report['version'] = (Get-Item -LiteralPath $launcher).VersionInfo.ProductVersion
  $report['stageSha256'] = (Get-FileHash -LiteralPath $stageArchive -Algorithm SHA256).Hash
  if ($PreviousInstaller) {
    if ([version]$report.version -le [version]$report.previousVersion) {
      throw 'A versão do instalador precisa ser posterior à versão instalada.'
    }
    $report['replacement'] = $report.stageSha256 -ne $report.previousStageSha256
    if (!$report.replacement) { throw 'O Stage instalado não mudou. Confira se os instaladores são de builds distintos.' }
  }
  & node --experimental-strip-types (Join-Path $PSScriptRoot 'check-native-stage.mjs') @gateArguments
  if ($LASTEXITCODE -ne 0) { throw 'O Launcher instalado falhou no gate de ciclo de vida.' }
  $report['lifecycle'] = $true
  $report['packageProcessesExited'] = $true
  if (!$PreviousInstaller) {
    $report['installedConversation'] = $true
    $report['conversationThroughLauncher'] = !$DirectStageConversation
    $report['conversationSource'] = if ($LocalModelPort) { 'operator-loopback' } else { 'synthetic-loopback' }
  }
  if ($PreviousInstaller) {
    $report['profilePreserved'] = $true
    $report['credentialPreserved'] = $true
  }
}
finally {
  if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
    $process = Start-Process -FilePath $uninstaller -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
    $report['uninstallExitCode'] = $process.ExitCode
    $report['uninstall'] = $process.ExitCode -eq 0 -and !(Test-Path -LiteralPath $launcher) -and !(Get-PreviewRegistration)
  }
  if ($report.uninstall -and $report.profilePreserved) {
    $report['testProfilePreservedAfterUninstall'] = $false
    try {
      $files = @('lia-product.json', 'lia-transports.json', 'native-stage-profile/lia-chat-history.json', 'lia-secrets.json')
      $baseline = ConvertFrom-Json -InputObject (Get-Content -LiteralPath (Join-Path $upgradeProfile 'upgrade-baseline.json') -Raw)
      $preserved = $baseline.Count -eq $files.Count
      foreach ($name in $files) {
        $expected = @($baseline | Where-Object name -CEQ $name)
        $path = Join-Path $upgradeProfile $name
        if ($expected.Count -ne 1 -or !(Test-Path -LiteralPath $path -PathType Leaf) -or
          (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ine $expected[0].sha256) {
          $preserved = $false
        }
      }
      $report['testProfilePreservedAfterUninstall'] = $preserved
    }
    catch {
      $report['testProfilePreservedAfterUninstall'] = $false
    }
  }
  $report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidence 'report.json') -Encoding UTF8
}

if (!$report.uninstall) { throw 'A desinstalação da prévia não foi confirmada.' }

if ($PreviousInstaller -and !$report.testProfilePreservedAfterUninstall) { throw 'O perfil de teste não foi preservado após a desinstalação.' }
