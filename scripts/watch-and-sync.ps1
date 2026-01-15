<#
.SYNOPSIS
    Background watcher that auto-syncs cookies between pools.
    When any pool's cookies change, propagate to all other pools.
.DESCRIPTION
    Runs in background and watches for cookie file changes.
    Start with: Start-Job -FilePath .\scripts\watch-and-sync.ps1
#>

param(
    [string]$ProfilesDir = "$env:USERPROFILE\.hydraspecter\profiles",
    [int]$DebounceSeconds = 5
)

$ErrorActionPreference = "Stop"

# Track last sync time per pool to debounce
$lastSync = @{}
for ($i = 0; $i -lt 10; $i++) { $lastSync["pool-$i"] = [DateTime]::MinValue }

function Sync-FromPool {
    param([string]$SourcePool)

    $sourceCookies = Join-Path $ProfilesDir "$SourcePool\Default\Network\Cookies"
    $sourceLocalState = Join-Path $ProfilesDir "$SourcePool\Local State"

    if (-not (Test-Path $sourceCookies)) { return }

    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Syncing from $SourcePool..." -ForegroundColor Cyan

    $synced = 0
    for ($i = 0; $i -lt 10; $i++) {
        $targetPool = "pool-$i"
        if ($targetPool -eq $SourcePool) { continue }

        $targetDir = Join-Path $ProfilesDir "$targetPool\Default\Network"
        $targetCookies = Join-Path $targetDir "Cookies"
        $targetLocalState = Join-Path $ProfilesDir "$targetPool\Local State"

        # Skip if target is in use (locked)
        $lockFile = Join-Path $ProfilesDir "..\locks\$targetPool.lock"
        if (Test-Path $lockFile) {
            Write-Host "  SKIP $targetPool (in use)" -ForegroundColor Yellow
            continue
        }

        try {
            if (-not (Test-Path $targetDir)) {
                New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
            }
            Copy-Item -Path $sourceCookies -Destination $targetCookies -Force -ErrorAction Stop
            if (Test-Path $sourceLocalState) {
                Copy-Item -Path $sourceLocalState -Destination $targetLocalState -Force -ErrorAction SilentlyContinue
            }
            $synced++
        } catch {
            Write-Host "  FAIL $targetPool: $($_.Exception.Message)" -ForegroundColor Red
        }
    }

    Write-Host "  Synced to $synced pools" -ForegroundColor Green
}

Write-Host "Cookie watcher started. Monitoring $ProfilesDir" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop." -ForegroundColor Gray

# Create FileSystemWatcher for each pool
$watchers = @()
for ($i = 0; $i -lt 10; $i++) {
    $poolPath = Join-Path $ProfilesDir "pool-$i\Default\Network"

    if (-not (Test-Path $poolPath)) {
        New-Item -ItemType Directory -Path $poolPath -Force | Out-Null
    }

    $watcher = New-Object System.IO.FileSystemWatcher
    $watcher.Path = $poolPath
    $watcher.Filter = "Cookies"
    $watcher.NotifyFilter = [System.IO.NotifyFilters]::LastWrite
    $watcher.EnableRaisingEvents = $true

    $poolName = "pool-$i"

    Register-ObjectEvent -InputObject $watcher -EventName Changed -Action {
        $pool = $Event.MessageData.Pool
        $lastSyncRef = $Event.MessageData.LastSync
        $debounce = $Event.MessageData.Debounce
        $profilesDir = $Event.MessageData.ProfilesDir

        # Debounce: ignore if synced recently
        $now = Get-Date
        if (($now - $lastSyncRef[$pool]).TotalSeconds -lt $debounce) { return }
        $lastSyncRef[$pool] = $now

        # Don't sync if this pool is locked (browser still using it)
        $lockFile = Join-Path $profilesDir "..\locks\$pool.lock"
        if (Test-Path $lockFile) { return }

        # Sync after a short delay (let file finish writing)
        Start-Sleep -Seconds 1
        Sync-FromPool -SourcePool $pool

    } -MessageData @{
        Pool = $poolName
        LastSync = $lastSync
        Debounce = $DebounceSeconds
        ProfilesDir = $ProfilesDir
    } | Out-Null

    $watchers += $watcher
}

# Keep running
try {
    while ($true) { Start-Sleep -Seconds 60 }
} finally {
    foreach ($w in $watchers) { $w.Dispose() }
    Write-Host "Watcher stopped." -ForegroundColor Yellow
}
