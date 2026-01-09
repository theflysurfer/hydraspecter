# Script to copy your real Chrome profile to HydraSpecter
# This helps bypass Google's "unsafe browser" detection

Write-Host "🔧 Chrome Profile Copy Script for HydraSpecter" -ForegroundColor Cyan
Write-Host ""

$chromeProfile = "$env:LOCALAPPDATA\Google\Chrome\User Data\Default"
$hydraProfile = "$env:USERPROFILE\.hydraspecter\profiles\pool-0"

# Check if Chrome profile exists
if (-not (Test-Path $chromeProfile)) {
    Write-Host "❌ Chrome profile not found at: $chromeProfile" -ForegroundColor Red
    Write-Host "   Make sure Chrome is installed and you've used it at least once." -ForegroundColor Yellow
    exit 1
}

# Check if Chrome is running
$chromeProcesses = Get-Process chrome -ErrorAction SilentlyContinue
if ($chromeProcesses) {
    Write-Host "⚠️  Chrome is currently running!" -ForegroundColor Yellow
    Write-Host "   Please close Chrome completely before continuing." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "   Chrome processes found:" -ForegroundColor Gray
    $chromeProcesses | ForEach-Object { Write-Host "     - PID: $($_.Id)" -ForegroundColor Gray }
    Write-Host ""

    $response = Read-Host "   Do you want to close Chrome now? (y/N)"
    if ($response -eq 'y' -or $response -eq 'Y') {
        Write-Host "   Closing Chrome..." -ForegroundColor Yellow
        Stop-Process -Name chrome -Force
        Start-Sleep -Seconds 2
    } else {
        Write-Host "   Aborted. Please close Chrome manually and run this script again." -ForegroundColor Red
        exit 1
    }
}

# Create hydra profile directory if it doesn't exist
$hydraBase = "$env:USERPROFILE\.hydraspecter\profiles"
if (-not (Test-Path $hydraBase)) {
    Write-Host "📁 Creating HydraSpecter profiles directory..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Path $hydraBase -Force | Out-Null
}

# Backup existing pool-0 if it exists
if (Test-Path $hydraProfile) {
    $backupPath = "$hydraProfile.backup.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
    Write-Host "💾 Backing up existing pool-0 to:" -ForegroundColor Yellow
    Write-Host "   $backupPath" -ForegroundColor Gray
    Move-Item -Path $hydraProfile -Destination $backupPath -Force
}

# Copy Chrome profile
Write-Host ""
Write-Host "📋 Copying Chrome profile..." -ForegroundColor Cyan
Write-Host "   From: $chromeProfile" -ForegroundColor Gray
Write-Host "   To:   $hydraProfile" -ForegroundColor Gray
Write-Host ""

try {
    Copy-Item -Path $chromeProfile -Destination $hydraProfile -Recurse -Force
    Write-Host "✅ Chrome profile copied successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "🎉 Done! Your Google sessions should now work in HydraSpecter." -ForegroundColor Green
    Write-Host ""
    Write-Host "📝 Note: The profile is copied to pool-0, so make sure to use that pool" -ForegroundColor Yellow
    Write-Host "   when creating browsers (it's the default)." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "⚠️  Security reminder:" -ForegroundColor Red
    Write-Host "   - Your Chrome cookies and sessions are now in HydraSpecter" -ForegroundColor Yellow
    Write-Host "   - Only use this on your personal machine" -ForegroundColor Yellow
    Write-Host "   - Don't commit the profile to git or share it" -ForegroundColor Yellow
} catch {
    Write-Host "❌ Failed to copy profile: $_" -ForegroundColor Red
    exit 1
}
