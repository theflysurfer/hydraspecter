<#
.SYNOPSIS
    Syncs session data from pool-0 to all other pools (pool-1 to pool-9).
    Run after logging in to a site on pool-0.
.DESCRIPTION
    Chrome v127+ uses App-Bound encryption (v20) which prevents copying cookies
    from Chrome to Chromium. Instead, log in once on pool-0 in HydraSpecter,
    then use this script to sync to other pools.

    Syncs: Cookies, History, Bookmarks, Web Data, Preferences, Local State
    This makes the browser look "lived in" for anti-detection.
#>

param(
    [string]$ProfilesDir = "$env:USERPROFILE\.hydraspecter\profiles",
    [int]$SourcePool = 0,
    [int[]]$TargetPools = @(1,2,3,4,5,6,7,8,9)
)

$ErrorActionPreference = "Stop"

# Files to sync for anti-detection (makes browser look "lived in")
$SyncFiles = @(
    @{ Src = "Default\Network\Cookies"; Required = $true },
    @{ Src = "Local State"; Required = $false },
    @{ Src = "Default\History"; Required = $false },
    @{ Src = "Default\Visited Links"; Required = $false },
    @{ Src = "Default\Web Data"; Required = $false },
    @{ Src = "Default\Bookmarks"; Required = $false },
    @{ Src = "Default\Preferences"; Required = $false }
)

# Directories to sync (Local Storage for Telegram, WhatsApp, etc.)
$SyncDirs = @(
    "Default\Local Storage"
)

$sourceDir = Join-Path $ProfilesDir "pool-$SourcePool"
$sourceCookies = Join-Path $sourceDir "Default\Network\Cookies"

if (-not (Test-Path $sourceCookies)) {
    Write-Host "Source cookies not found: $sourceCookies" -ForegroundColor Red
    exit 1
}

Write-Host "Syncing from pool-$SourcePool to pools: $($TargetPools -join ', ')" -ForegroundColor Cyan

$synced = 0
foreach ($i in $TargetPools) {
    $targetDir = Join-Path $ProfilesDir "pool-$i"

    # Check if pool is locked
    $lockFile = Join-Path $ProfilesDir "..\locks\pool-$i.lock"
    if (Test-Path $lockFile) {
        Write-Host "  SKIP pool-$i (in use)" -ForegroundColor Yellow
        continue
    }

    try {
        $fileCount = 0
        foreach ($file in $SyncFiles) {
            $srcPath = Join-Path $sourceDir $file.Src
            $destPath = Join-Path $targetDir $file.Src

            if (-not (Test-Path $srcPath)) {
                if ($file.Required) { throw "Required file missing: $($file.Src)" }
                continue
            }

            # Create target directory if needed
            $destDir = Split-Path $destPath
            if (-not (Test-Path $destDir)) {
                New-Item -ItemType Directory -Path $destDir -Force | Out-Null
            }

            Copy-Item -Path $srcPath -Destination $destPath -Force
            $fileCount++
        }

        # Sync directories (Local Storage for Telegram, WhatsApp, etc.)
        foreach ($dir in $SyncDirs) {
            $srcDir = Join-Path $sourceDir $dir
            $destDir = Join-Path $targetDir $dir

            if (Test-Path $srcDir) {
                # Remove existing and copy fresh
                if (Test-Path $destDir) {
                    Remove-Item -Path $destDir -Recurse -Force -ErrorAction SilentlyContinue
                }
                Copy-Item -Path $srcDir -Destination $destDir -Recurse -Force
                $fileCount++
            }
        }

        $size = [math]::Round((Get-Item (Join-Path $targetDir "Default\Network\Cookies")).Length / 1KB)
        Write-Host "  OK pool-$i ($size KB, $fileCount files/dirs)" -ForegroundColor Green
        $synced++
    } catch {
        $errMsg = $_.Exception.Message
        Write-Host "  FAIL pool-$i - $errMsg" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Done! $synced/$($TargetPools.Count) pools synced." -ForegroundColor Green
