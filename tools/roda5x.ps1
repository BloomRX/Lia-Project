# Roda a suite Python de tools/ cinco vezes e grava a evidencia em
# docs/product/python-cleanup-5x.md
#
# Uso, a partir da raiz do repositorio:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\roda5x.ps1
#
# Por que cinco vezes: a falha de limpeza de fixture era intermitente e
# dependia de o git ter empacotado objetos naquela execucao. Uma rodada verde
# nao prova nada; a repeticao e que prova.
#
# Quanto tempo leva: varios minutos por rodada. O script avisa antes de cada
# uma comecar e grava a evidencia parcial depois de cada uma terminar, entao
# uma rodada ja concluida nunca se perde.
#
# Este arquivo e ASCII de proposito. O PowerShell 5.1 le .ps1 como ANSI quando
# nao ha BOM, e acento aqui viraria lixo.

$ErrorActionPreference = 'Continue'

$repo = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path (Join-Path $repo 'tools\project_cli.py'))) {
  Write-Host 'ERRO: nao achei tools\project_cli.py. Rode a partir do repositorio.'
  exit 1
}

# Descobre um interpretador que funcione de verdade. No Windows o "python" do
# PATH pode ser o stub da Microsoft Store, que nao executa nada.
$pyExe = 'python'
$pyPre = @()
$probe = (& python --version 2>&1) -join ' '

if ($LASTEXITCODE -ne 0 -or $probe -notmatch 'Python \d') {
  $probe = (& py -3 --version 2>&1) -join ' '
  if ($LASTEXITCODE -eq 0 -and $probe -match 'Python \d') {
    $pyExe = 'py'
    $pyPre = @('-3')
  }
  else {
    Write-Host 'ERRO: nem "python" nem "py -3" respondeu. Nada foi executado.'
    exit 1
  }
}

$pyVersion = (& $pyExe @pyPre --version 2>&1) -join ' '
Write-Host "interpretador: $pyVersion ($pyExe)"
Write-Host ''

$cabecalho = @()
$cabecalho += '# Python tools/ - 5 repeticoes no Windows'
$cabecalho += ''
$cabecalho += "Gerado por tools/roda5x.ps1 em $(Get-Date -Format 'yyyy-MM-dd HH:mm')."
$cabecalho += ''
$cabecalho += "- Interpretador: $pyVersion"
$cabecalho += '- cwd: tools/'
$cabecalho += '- Comando: -m unittest discover -s . -p "test_*.py" -t .'
$cabecalho += "- Host: $env:COMPUTERNAME"

$destino = Join-Path $repo 'docs\product\python-cleanup-5x.md'

# Grava o que existe ate agora. E chamado depois de CADA rodada para que uma
# interrupcao no meio nao apague as rodadas ja pagas.
function Grava-Evidencia {
  param([int]$Rodada, [int]$Total, [int]$Verdes, [object[]]$Bloco)
  $l = @()
  $l += $cabecalho
  $l += ''
  if ($Rodada -lt $Total) {
    $l += "Progresso: $Rodada de $Total rodadas concluidas; $Verdes em exit 0. Rodada em andamento."
  }
  else {
    $l += "Resumo: $Verdes de $Total rodadas terminaram em exit 0."
  }
  $l += ''
  $l += $Bloco
  $enc = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($destino, ($l -join "`r`n") + "`r`n", $enc)
}

Set-Location (Join-Path $repo 'tools')

$bloco = @()
$verdes = 0
$total = 5

for ($n = 1; $n -le $total; $n++) {
  Write-Host ("rodada {0} de {1}: rodando, leva alguns minutos..." -f $n, $total)
  $inicio = Get-Date
  $out = & $pyExe @pyPre -m unittest discover -s . -p 'test_*.py' -t . 2>&1 | Out-String
  $code = $LASTEXITCODE
  $seg = [Math]::Round(((Get-Date) - $inicio).TotalSeconds, 1)

  if ($code -eq 0) { $verdes++ }

  Write-Host ("rodada {0} -> exit {1} em {2}s" -f $n, $code, $seg)

  $bloco += "===== rodada $n | exit $code | ${seg}s ====="
  $bloco += $out.TrimEnd()
  $bloco += ''

  Grava-Evidencia -Rodada $n -Total $total -Verdes $verdes -Bloco $bloco
}

Set-Location $repo

Write-Host ''
Write-Host "gravado em $destino"
Write-Host "resumo: $verdes de $total em exit 0"
Write-Host ''
Write-Host '--- linhas que importam ---'

Select-String -Path $destino -Pattern 'WinError|ERROR:|FAILED|^Ran |exit ' |
  ForEach-Object { $_.Line }

Write-Host ''
Write-Host 'Para enviar a evidencia:'
Write-Host '  git add docs/product/python-cleanup-5x.md'
Write-Host '  git commit -m "test: evidencia de 5 repeticoes da suite Python no Windows"'
Write-Host '  git push origin arena/01a10290-lia-project'
