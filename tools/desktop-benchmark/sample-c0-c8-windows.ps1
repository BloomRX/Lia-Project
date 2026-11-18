#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 2147483647)]
    [int] $RootPid,
    [ValidateRange(1, 2147483647)]
    [int[]] $AdditionalRootPid = @(),
    [Parameter(Mandatory = $true)]
    [ValidatePattern('\A[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\z')]
    [string] $Label,
    [Parameter(Mandatory = $true)]
    [string] $OutputRoot,
    [ValidateRange(1, 100)]
    [int] $Reps = 5,
    [ValidateRange(0, 86400)]
    [int] $Warmup = 60,
    [ValidateRange(1, 86400)]
    [int] $Window = 180
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'O amostrador requer Windows.'
}

function Get-Tree {
    param([hashtable] $RootStarts)

    $processes = @(Get-CimInstance Win32_Process)
    $tree = @{}
    foreach ($entry in $RootStarts.GetEnumerator()) {
        $root = Get-Process -Id $entry.Key
        if ($root.StartTime.ToUniversalTime() -ne $entry.Value) {
            throw "A identidade do processo raiz $($entry.Key) mudou."
        }
        $snapshotRoot = $processes | Where-Object { $_.ProcessId -eq $entry.Key }
        if (-not $snapshotRoot -or
            [math]::Abs(($snapshotRoot.CreationDate.ToUniversalTime() - $entry.Value).TotalMilliseconds) -gt 1) {
            throw "A raiz $($entry.Key) mudou durante o snapshot."
        }
        $tree[$entry.Key] = $snapshotRoot
    }

    do {
        $added = $false
        foreach ($process in $processes) {
            $processId = [int] $process.ProcessId
            $parentId = [int] $process.ParentProcessId
            if ($tree.ContainsKey($parentId) -and -not $tree.ContainsKey($processId) -and
                $process.CreationDate -and $process.CreationDate -ge $tree[$parentId].CreationDate) {
                $tree[$processId] = $process
                $added = $true
            }
        }
    } while ($added)
    $tree.Values | Sort-Object ProcessId
}

$rootStarts = @{}
foreach ($processId in (@($RootPid) + $AdditionalRootPid | Sort-Object -Unique)) {
    $rootStarts[$processId] = (Get-Process -Id $processId).StartTime.ToUniversalTime()
}
$logicalProcessors = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
if ($logicalProcessors -lt 1) {
    throw 'A contagem de processadores logicos esta indisponivel.'
}

$sampleSeconds = 5
$startedAt = [datetime]::UtcNow
$runName = '{0:yyyyMMddTHHmmssfffZ}-{1}-{2}' -f $startedAt, $Label, [guid]::NewGuid().ToString('N')
$outputPath = Join-Path $OutputRoot $runName
[void] [IO.Directory]::CreateDirectory($outputPath)
$csv = Join-Path $outputPath 'samples.csv'
[ordered] @{
    schema = 1
    label = $Label
    startedAtUtc = $startedAt.ToString('o')
    rootPid = $RootPid
    additionalRootPids = $AdditionalRootPid
    roots = @(foreach ($entry in $rootStarts.GetEnumerator() | Sort-Object Key) {
        @{ pid = $entry.Key; startTimeUtc = $entry.Value.ToString('o') }
    })
    reps = $Reps
    warmupS = $Warmup
    windowS = $Window
    sampleS = $sampleSeconds
    logicalProcessors = $logicalProcessors
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $outputPath 'metadata.json') -Encoding UTF8

$rows = 0
for ($rep = 1; $rep -le $Reps; $rep++) {
    Start-Sleep -Seconds $Warmup
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $previousCpu = @{}
    $previousTime = $null
    while ($clock.Elapsed.TotalSeconds -lt $Window) {
        $tree = @(Get-Tree -RootStarts $rootStarts)
        $sampleTime = $clock.Elapsed.TotalSeconds
        $currentCpu = @{}
        $privateBytes = 0L
        $workingSet = 0L
        $threads = 0
        $cpuDelta = 0.0
        foreach ($process in $tree) {
            $processId = [int] $process.ProcessId
            try {
                $observed = Get-Process -Id $processId
                $startTime = $observed.StartTime.ToUniversalTime()
                if ([math]::Abs(($process.CreationDate.ToUniversalTime() - $startTime).TotalMilliseconds) -gt 1) {
                    throw "O processo $processId mudou durante a leitura."
                }
                $processPrivateBytes = $observed.PrivateMemorySize64
                $processWorkingSet = $observed.WorkingSet64
                $processThreadCount = $observed.Threads.Count
                $cpu = $observed.TotalProcessorTime.TotalSeconds
                if ($observed.HasExited) {
                    throw "O processo $processId saiu durante a leitura."
                }
            }
            catch {
                if ($rootStarts.ContainsKey($processId)) {
                    throw
                }
                continue
            }
            $privateBytes += $processPrivateBytes
            $workingSet += $processWorkingSet
            $threads += $processThreadCount
            $identity = '{0}:{1}' -f $processId, $startTime.ToString('o')
            $currentCpu[$identity] = $cpu
            if ($previousCpu.ContainsKey($identity)) {
                $cpuDelta += $cpu - $previousCpu[$identity]
            }
        }
        $complete = $currentCpu.Count -eq $tree.Count
        $cpuPctMachine = $null
        if ($complete -and $null -ne $previousTime -and $sampleTime -gt $previousTime -and
            $cpuDelta -ge 0 -and $previousCpu.Count -eq $currentCpu.Count -and
            @($currentCpu.Keys | Where-Object { -not $previousCpu.ContainsKey($_) }).Count -eq 0) {
            $cpuPctMachine = [math]::Round(100.0 * $cpuDelta / ($sampleTime - $previousTime) / $logicalProcessors, 2)
        }

        $crashpadCount = @($tree | Where-Object {
            $_.Name -like 'crashpad*' -or $_.CommandLine -match '(?:^|\s)--type=crashpad-handler(?:\s|$)'
        }).Count
        [pscustomobject] @{
            label = $Label
            rep = $rep
            t = [math]::Round($sampleTime, 1)
            privateMB = $(if ($complete) { [math]::Round($privateBytes / 1MB, 1) })
            wsMB = $(if ($complete) { [math]::Round($workingSet / 1MB, 1) })
            processes = $tree.Count
            processesNoCrashpad = $tree.Count - $crashpadCount
            threads = $(if ($complete) { $threads })
            cpuPctMachine = $cpuPctMachine
            complete = $complete
            identities = ($currentCpu.Keys | Sort-Object) -join '|'
        } | Export-Csv -LiteralPath $csv -NoTypeInformation -Append -Encoding UTF8
        $rows++
        if ($complete) {
            $previousCpu = $currentCpu
            $previousTime = $sampleTime
        }
        else {
            $previousTime = $null
        }
        $remainingMs = [int] [math]::Floor(1000 * ($Window - $clock.Elapsed.TotalSeconds))
        if ($remainingMs -gt 0) {
            Start-Sleep -Milliseconds ([math]::Min($sampleSeconds * 1000, $remainingMs))
        }
    }
}

@{
    sampleCount = $rows
    completedAtUtc = [datetime]::UtcNow.ToString('o')
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputPath 'completion.json') -Encoding UTF8
Write-Output $outputPath
