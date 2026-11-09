#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [int[]] $ProcessId,
    [ValidateRange(1, 86400)]
    [int] $DurationSeconds = 60,
    [ValidateRange(0.1, 3600)]
    [double] $IntervalSeconds = 1,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('\A[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\z')]
    [string] $ScenarioLabel,
    [string] $OutputRoot = 'J:\lia-evidence',
    [switch] $IncludeGpu,
    [switch] $IncludePrivateWorkingSet
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (@($ProcessId | Where-Object { $_ -le 0 }).Count -gt 0) {
    throw 'ProcessId deve conter somente identificadores positivos.'
}
if ($IntervalSeconds -gt $DurationSeconds) {
    throw 'IntervalSeconds deve ser menor ou igual a DurationSeconds.'
}
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'Este coletor requer Windows.'
}

$targetIds = @($ProcessId | Sort-Object -Unique)
$repositoryPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')).TrimEnd('\', '/')
$rootPath = [IO.Path]::GetFullPath($OutputRoot)
if ($rootPath.TrimEnd('\', '/').Equals($repositoryPath, [StringComparison]::OrdinalIgnoreCase) -or
    $rootPath.StartsWith($repositoryPath + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'OutputRoot deve ficar fora do repositorio.'
}
# Reject existing junctions/symlinks in the output ancestry as well as lexical paths.
$ancestorPath = $rootPath
while (-not [string]::IsNullOrEmpty($ancestorPath)) {
    if (Test-Path -LiteralPath $ancestorPath) {
        $ancestor = Get-Item -LiteralPath $ancestorPath -Force
        if (($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'OutputRoot nao pode atravessar junction ou link simbolico.'
        }
    }
    $parentPath = [IO.Path]::GetDirectoryName($ancestorPath)
    if ($parentPath -eq $ancestorPath) { break }
    $ancestorPath = $parentPath
}

$logicalProcessors = [Environment]::ProcessorCount
$encoding = New-Object Text.UTF8Encoding($false)
function Write-NewJson([string] $Path, [object] $Value) {
    $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    $writer = New-Object IO.StreamWriter($stream, $encoding)
    try { $writer.WriteLine(($Value | ConvertTo-Json -Depth 12)); $writer.Flush() }
    finally { $writer.Dispose() }
}
function Read-Target([int] $TargetId) {
    $process = $null
    try {
        $process = Get-Process -Id $TargetId -ErrorAction Stop
        $process.Refresh()
        $started = $process.StartTime.ToUniversalTime()
        $identity = $started.Ticks
        $data = [pscustomobject]@{
            status = 'available'; reason = $null; pid = $TargetId
            name = $process.ProcessName; startTimeUtc = $started.ToString('o')
            startTicks = $identity; cpuSeconds = $process.TotalProcessorTime.TotalSeconds
            workingSetBytes = $process.WorkingSet64; privateBytes = $process.PrivateMemorySize64
            threadCount = $process.Threads.Count
        }
        $process.Refresh()
        if ($process.HasExited -or $process.StartTime.ToUniversalTime().Ticks -ne $identity) {
            throw 'Identity changed while reading.'
        }
        return $data
    }
    catch {
        return [pscustomobject]@{
            status = 'unavailable'; reason = ('process_unreadable_or_exited:' + $_.Exception.GetType().Name)
            pid = $TargetId
        }
    }
    finally { if ($null -ne $process) { $process.Dispose() } }
}
function Read-Gpu([string] $ClassName, [string[]] $Properties, [int[]] $ActiveIds) {
    if (-not $IncludeGpu) { return @{ status = 'unavailable'; reason = 'not_requested'; counters = @() } }
    if ($ActiveIds.Count -eq 0) { return @{ status = 'unavailable'; reason = 'no_valid_process_identity'; counters = @() } }
    try {
        $clauses = @($ActiveIds | ForEach-Object { "Name LIKE 'pid_$($_)_%'" })
        $counters = @(Get-CimInstance -ClassName $ClassName -Filter ($clauses -join ' OR ') -OperationTimeoutSec 2 -ErrorAction Stop)
        $rows = @()
        foreach ($counter in $counters) {
            # WQL '_' is a wildcard: independently verify the exact PID prefix.
            if ($counter.Name -notmatch '^pid_(\d+)_') { continue }
            $counterId = [int] $Matches[1]
            if ($ActiveIds -notcontains $counterId) { continue }
            $row = [ordered]@{ pid = $counterId; instance = [string] $counter.Name }
            foreach ($property in $Properties) { $row[$property] = $counter.$property }
            $rows += [pscustomobject] $row
        }
        if ($rows.Count -eq 0) { return @{ status = 'unavailable'; reason = 'no_matching_counters'; counters = @() } }
        return @{ status = 'available'; reason = $null; counters = $rows }
    }
    catch { return @{ status = 'unavailable'; reason = ('counter_query_failed:' + $_.Exception.GetType().Name); counters = @() } }
}

$runId = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + $ScenarioLabel + '-' + [Guid]::NewGuid().ToString('N')
$runDirectory = Join-Path $rootPath $runId
if (-not (Test-Path -LiteralPath $rootPath)) { $null = New-Item -ItemType Directory -Path $rootPath }
$null = New-Item -ItemType Directory -Path $runDirectory
$baselines = @{}
$previous = @{}
$initial = @()
$processRoles = @{}
try {
    foreach ($item in @(Get-CimInstance Win32_Process -OperationTimeoutSec 2 -ErrorAction Stop)) {
        if ($targetIds -notcontains [int] $item.ProcessId) { continue }
        $role = 'main_or_auxiliary'
        if ($item.CommandLine -match '(?:^|\s)--type=([a-zA-Z0-9_-]+)(?:\s|$)') { $role = $Matches[1] }
        $processRoles[[string] $item.ProcessId] = @{ role = $role; parentPid = [int] $item.ParentProcessId }
    }
}
catch { } # Role metadata is optional; never capture raw command lines.
foreach ($targetId in $targetIds) {
    $reading = Read-Target $targetId
    $baselines[$targetId] = $reading
    $initial += $reading
}
$unmeasured = @{ status = 'unavailable'; reason = 'not_measured_by_this_collector' }
Write-NewJson (Join-Path $runDirectory 'metadata.json') ([ordered]@{
    schemaVersion = 1; startedAtUtc = [DateTime]::UtcNow.ToString('o'); scenarioLabel = $ScenarioLabel
    scope = 'explicit_pids_only_no_process_tree'; requestedProcessIds = $targetIds
    durationSeconds = $DurationSeconds; intervalSeconds = $IntervalSeconds
    logicalProcessors = $logicalProcessors; collectorPid = $PID
    powershellVersion = $PSVersionTable.PSVersion.ToString(); osVersion = [Environment]::OSVersion.VersionString
    gpuRequested = [bool] $IncludeGpu; privateWorkingSetRequested = [bool] $IncludePrivateWorkingSet; initialProcesses = $initial
    processRoles = $processRoles
    privateWorkingSetIdentityLimit = 'PID counters are sampled before the live identity check; counter caching can still lag a process lifetime.'
    gpuIdentityLimit = 'Counters encode PID only; live identity is rechecked, but stale driver counters cannot be assigned to a process lifetime with certainty.'
    fps = $unmeasured; frameTime = $unmeasured; gameImpact = $unmeasured; systemPower = $unmeasured
})
$sampleStream = [IO.File]::Open((Join-Path $runDirectory 'samples.jsonl'), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
$sampleWriter = New-Object IO.StreamWriter($sampleStream, $encoding)
$clock = [Diagnostics.Stopwatch]::StartNew()
$sampleCount = 0
$collectionStatus = 'completed'
try {
    while ($clock.Elapsed.TotalSeconds -le $DurationSeconds) {
        $sampleStarted = $clock.Elapsed.TotalSeconds
        $processRows = @()
        $validIds = @()
        $privateWorkingSets = @{}
        $privateWorkingSetReason = 'not_requested'
        if ($IncludePrivateWorkingSet) {
            try {
                $filter = @($targetIds | ForEach-Object { "IDProcess = $_" }) -join ' OR '
                foreach ($counter in @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter $filter -OperationTimeoutSec 2 -ErrorAction Stop)) {
                    $privateWorkingSets[[int] $counter.IDProcess] = [long] $counter.WorkingSetPrivate
                }
                $privateWorkingSetReason = 'no_matching_counter'
            }
            catch { $privateWorkingSetReason = 'counter_query_failed:' + $_.Exception.GetType().Name }
        }
        foreach ($targetId in $targetIds) {
            $current = Read-Target $targetId
            $observedAt = $clock.Elapsed.TotalSeconds
            $baseline = $baselines[$targetId]
            if ($baseline.status -ne 'available') {
                $current = [pscustomobject]@{ pid = $targetId; status = 'unavailable'; reason = 'initial_identity_unavailable' }
            }
            elseif ($current.status -eq 'available' -and $current.startTicks -ne $baseline.startTicks) {
                $current = [pscustomobject]@{ pid = $targetId; status = 'unavailable'; reason = 'pid_reused_identity_mismatch' }
            }
            if ($current.status -eq 'available') {
                $validIds += $targetId
                $cpu = @{ status = 'unavailable'; reason = 'first_sample'; cpuCores = $null; percentOfMachine = $null }
                if ($previous.ContainsKey($targetId)) {
                    $elapsed = $observedAt - $previous[$targetId].at
                    $delta = $current.cpuSeconds - $previous[$targetId].cpu
                    if ($elapsed -gt 0 -and $delta -ge 0) {
                        $cores = $delta / $elapsed
                        $cpu = @{ status = 'available'; reason = $null; cpuCores = $cores; percentOfMachine = 100 * $cores / $logicalProcessors }
                    }
                    else { $cpu.reason = 'invalid_cpu_delta' }
                }
                $previous[$targetId] = @{ at = $observedAt; cpu = $current.cpuSeconds }
                $processRows += [pscustomobject]@{
                    pid = $targetId; startTimeUtc = $current.startTimeUtc; status = 'available'; reason = $null
                    observedAtSeconds = $observedAt; workingSetBytes = $current.workingSetBytes
                    privateBytes = $current.privateBytes; cpu = $cpu
                    threadCount = $current.threadCount
                    privateWorkingSet = $(if ($privateWorkingSets.ContainsKey($targetId)) {
                        @{ status = 'available'; bytes = $privateWorkingSets[$targetId]; reason = $null }
                    } else { @{ status = 'unavailable'; bytes = $null; reason = $privateWorkingSetReason } })
                }
            }
            else {
                $previous.Remove($targetId)
                $processRows += $current
            }
        }
        $gpuEngine = Read-Gpu 'Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine' @('UtilizationPercentage') $validIds
        $gpuMemory = Read-Gpu 'Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory' @('DedicatedUsage', 'SharedUsage') $validIds
        # GPU counter names contain PIDs but no creation time. Recheck after CIM to reject PID recycling during the query.
        foreach ($targetId in $validIds) {
            $afterGpu = Read-Target $targetId
            if ($afterGpu.status -ne 'available' -or $afterGpu.startTicks -ne $baselines[$targetId].startTicks) {
                $gpuEngine.counters = @($gpuEngine.counters | Where-Object { $_.pid -ne $targetId })
                $gpuMemory.counters = @($gpuMemory.counters | Where-Object { $_.pid -ne $targetId })
                $gpuEngine.status = 'unavailable'; $gpuEngine.reason = 'identity_changed_during_gpu_query'
                $gpuMemory.status = 'unavailable'; $gpuMemory.reason = 'identity_changed_during_gpu_query'
            }
        }
        $record = [ordered]@{
            sample = $sampleCount; utc = [DateTime]::UtcNow.ToString('o'); startedAtSeconds = $sampleStarted
            completedAtSeconds = $clock.Elapsed.TotalSeconds; processes = $processRows
            gpuEngine = $gpuEngine; gpuMemory = $gpuMemory
        }
        $sampleWriter.WriteLine(($record | ConvertTo-Json -Depth 12 -Compress))
        $sampleWriter.Flush()
        $sampleCount++
        $remaining = [Math]::Min($IntervalSeconds - ($clock.Elapsed.TotalSeconds - $sampleStarted), $DurationSeconds - $clock.Elapsed.TotalSeconds)
        if ($remaining -gt 0) { Start-Sleep -Milliseconds ([int] [Math]::Ceiling(1000 * $remaining)) }
    }
}
catch { $collectionStatus = 'failed'; throw }
finally {
    $clock.Stop()
    $sampleWriter.Dispose()
    Write-NewJson (Join-Path $runDirectory 'summary.json') ([ordered]@{
        status = $collectionStatus; sampleCount = $sampleCount; elapsedSeconds = $clock.Elapsed.TotalSeconds
        completedAtUtc = [DateTime]::UtcNow.ToString('o')
        warning = 'Collection success does not imply metrics availability or Lia benchmark approval.'
    })
}
Write-Output $runDirectory
