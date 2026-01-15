#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Syncs Chrome cookies to HydraSpecter pools using Volume Shadow Copy.
    Works even when Chrome is running and has the cookies file locked.
#>

param(
    [string]$TargetDir = "$env:USERPROFILE\.hydraspecter\profiles"
)

$ErrorActionPreference = "Stop"

# Chrome cookies path
$ChromeCookiesPath = "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Network\Cookies"
$MountPoint = "C:\VSSMount"

if (-not (Test-Path $ChromeCookiesPath)) {
    Write-Host "Chrome cookies not found at: $ChromeCookiesPath" -ForegroundColor Red
    exit 1
}

Write-Host "Creating VSS snapshot..." -ForegroundColor Cyan

# Create shadow copy using wmic (works on Windows 10/11)
$wmicOutput = cmd /c 'wmic shadowcopy call create Volume="C:\"' 2>&1

# Parse the ShadowID from output like: ShadowID = "{GUID}"
$shadowIdMatch = [regex]::Match($wmicOutput, 'ShadowID = "(\{[^}]+\})"')
if (-not $shadowIdMatch.Success) {
    Write-Host "Failed to create shadow copy: $wmicOutput" -ForegroundColor Red
    exit 1
}

$shadowId = $shadowIdMatch.Groups[1].Value
Write-Host "Shadow copy created: $shadowId" -ForegroundColor Green

# Get the shadow copy device path using CIM (read-only works fine)
Start-Sleep -Seconds 1
$shadow = Get-CimInstance Win32_ShadowCopy | Where-Object { $_.ID -eq $shadowId }
if (-not $shadow) {
    Write-Host "Could not find shadow copy with ID: $shadowId" -ForegroundColor Red
    exit 1
}

$devicePath = $shadow.DeviceObject

Write-Host "Device path: $devicePath" -ForegroundColor Gray

try {
    # IMPORTANT: Must mount the shadow copy via symlink to access it!
    # VSS device paths cannot be browsed directly
    Write-Host "Mounting shadow copy..." -ForegroundColor Cyan

    # Remove existing mount point if present
    if (Test-Path $MountPoint) {
        cmd /c "rmdir `"$MountPoint`"" 2>$null
    }

    # Create symbolic link - MUST have trailing backslash on device path!
    $devicePathWithSlash = "$devicePath\"
    $mkLinkResult = cmd /c "mklink /d `"$MountPoint`" `"$devicePathWithSlash`"" 2>&1

    if (-not (Test-Path $MountPoint)) {
        Write-Host "Failed to create mount point: $mkLinkResult" -ForegroundColor Red
        exit 1
    }

    Write-Host "Mounted at: $MountPoint" -ForegroundColor Green

    # Build path to cookies in mounted shadow copy
    $relativePath = $ChromeCookiesPath.Substring(3)  # Remove "C:\"
    $shadowCookiesPath = "$MountPoint\$relativePath"

    Write-Host "Source: $shadowCookiesPath" -ForegroundColor Cyan

    # Verify source exists
    if (-not (Test-Path $shadowCookiesPath)) {
        Write-Host "ERROR: Cookies not found in shadow copy!" -ForegroundColor Red

        # Debug
        $testPath = "$MountPoint\Users"
        Write-Host "Users folder exists: $(Test-Path $testPath)" -ForegroundColor Yellow
        exit 1
    }

    $sourceSize = (Get-Item $shadowCookiesPath).Length
    Write-Host "Source size: $([math]::Round($sourceSize/1KB)) KB" -ForegroundColor Green

    # Get pool directories
    $pools = Get-ChildItem -Path $TargetDir -Directory -Filter "pool-*" -ErrorAction SilentlyContinue

    if ($pools.Count -eq 0) {
        Write-Host "Creating default pools..." -ForegroundColor Cyan
        for ($i = 0; $i -lt 10; $i++) {
            New-Item -ItemType Directory -Path "$TargetDir\pool-$i\Network" -Force | Out-Null
        }
        $pools = Get-ChildItem -Path $TargetDir -Directory -Filter "pool-*"
    }

    $synced = 0
    foreach ($pool in $pools) {
        # Only sync to pool-0 through pool-9
        if ($pool.Name -notmatch '^pool-\d$') {
            continue
        }

        $targetPath = Join-Path $pool.FullName "Network\Cookies"
        $targetNetworkDir = Split-Path $targetPath

        if (-not (Test-Path $targetNetworkDir)) {
            New-Item -ItemType Directory -Path $targetNetworkDir -Force | Out-Null
        }

        try {
            Copy-Item -Path $shadowCookiesPath -Destination $targetPath -Force -ErrorAction Stop
            $destSize = (Get-Item $targetPath).Length
            Write-Host "  OK $($pool.Name) ($([math]::Round($destSize/1KB)) KB)" -ForegroundColor Green
            $synced++
        } catch {
            Write-Host "  FAIL $($pool.Name): $($_.Exception.Message)" -ForegroundColor Red
        }
    }

    Write-Host ""
    Write-Host "Done! $synced pools synced." -ForegroundColor Green

} finally {
    # Cleanup: remove mount point
    if (Test-Path $MountPoint) {
        Write-Host "Removing mount point..." -ForegroundColor Cyan
        cmd /c "rmdir `"$MountPoint`"" 2>$null
    }

    # Cleanup: delete shadow copy
    if ($shadowId) {
        Write-Host "Deleting shadow copy..." -ForegroundColor Cyan
        Get-CimInstance Win32_ShadowCopy | Where-Object { $_.ID -eq $shadowId } | Remove-CimInstance
        Write-Host "Shadow copy deleted." -ForegroundColor Green
    }
}
