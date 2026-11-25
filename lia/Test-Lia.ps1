param([switch]$Prepare)

$ErrorActionPreference = 'Stop'

if ($Prepare) {
    & (Join-Path (Split-Path $PSScriptRoot) 'Lia.bat') -PrepareOnly
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

$failures = New-Object 'System.Collections.Generic.List[string]'
function Invoke-LiaCheck {
    param([string]$Package, [string]$Label, [scriptblock]$Command)

    Push-Location -LiteralPath (Join-Path $PSScriptRoot $Package)
    try {
        Write-Host "== $Label =="
        & $Command
        if ($LASTEXITCODE -ne 0) {
            $failures.Add("$Label (código $LASTEXITCODE)")
        }
    }
    catch {
        $failures.Add($Label)
        Write-Host $_
    }
    finally {
        Pop-Location
    }
}

Invoke-LiaCheck core 'Contratos do Core' { node --experimental-strip-types --test 'test/*.test.ts' }
Invoke-LiaCheck runtime 'Tipos do runtime' { corepack pnpm run typecheck }
Invoke-LiaCheck runtime 'Testes do runtime' { corepack pnpm run test }
Invoke-LiaCheck stage 'Tipos do Stage' { corepack pnpm run typecheck }
Invoke-LiaCheck stage 'Testes do Stage' { corepack pnpm run test }
Invoke-LiaCheck desktop 'Tipos do Launcher' { corepack pnpm run typecheck }
Invoke-LiaCheck desktop 'Lint dos pacotes próprios' { corepack pnpm run lint }
Invoke-LiaCheck desktop 'Testes do Launcher' { corepack pnpm run test }
Invoke-LiaCheck desktop 'Testes do empacotador Windows' { node --test scripts/package-windows.test.mjs }
Invoke-LiaCheck desktop 'Pré-requisitos do pacote privado' { node scripts/package-windows.mjs --internal-test --check }

if ($failures.Count -gt 0) {
    Write-Host ('Falhas: ' + ($failures -join ', '))
    exit 1
}
exit 0
