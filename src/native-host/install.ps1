# HydraSpecter Native Messaging Host Installer
# Run from the native-host directory or provide -ProjectRoot parameter

param(
    [string]$ProjectRoot = ""
)

$ErrorActionPreference = "Stop"

# Auto-detect project root from script location
if (-not $ProjectRoot) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $ProjectRoot = Split-Path -Parent (Split-Path -Parent $scriptDir)
}

$hostName = "com.hydraspecter.inject"
$nativeHostDir = Join-Path $ProjectRoot "src\native-host"
$extensionDir = Join-Path $ProjectRoot "src\extension"
$manifestPath = Join-Path $nativeHostDir "manifest.json"
$hostBatPath = Join-Path $nativeHostDir "host.bat"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " HydraSpecter Native Host Installer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Project root: $ProjectRoot"
Write-Host "Native host:  $nativeHostDir"
Write-Host "Extension:    $extensionDir"
Write-Host ""

# Verify host.bat exists
if (-not (Test-Path $hostBatPath)) {
    Write-Error "host.bat not found at: $hostBatPath"
    exit 1
}

# Generate manifest.json with correct path
$manifest = @{
    name = $hostName
    description = "HydraSpecter CSS/JS Injection Native Host"
    path = $hostBatPath
    type = "stdio"
    allowed_origins = @(
        "chrome-extension://*/",
        "chromium-extension://*/"
    )
}

# ConvertTo-Json escapes backslashes, so we need to write raw JSON
$manifestJson = @"
{
  "name": "$hostName",
  "description": "HydraSpecter CSS/JS Injection Native Host",
  "path": "$($hostBatPath.Replace('\', '\\'))",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://*/",
    "chromium-extension://*/"
  ]
}
"@
$manifestJson | Out-File -FilePath $manifestPath -Encoding UTF8 -NoNewline -Force
Write-Host "[OK] Generated manifest.json" -ForegroundColor Green

# Chrome registry path (current user)
$chromeRegPath = "HKCU:\SOFTWARE\Google\Chrome\NativeMessagingHosts\$hostName"
$chromiumRegPath = "HKCU:\SOFTWARE\Chromium\NativeMessagingHosts\$hostName"
$edgeRegPath = "HKCU:\SOFTWARE\Microsoft\Edge\NativeMessagingHosts\$hostName"

function Register-NativeHost {
    param (
        [string]$RegPath,
        [string]$BrowserName
    )

    try {
        $parentPath = Split-Path $RegPath -Parent
        if (-not (Test-Path $parentPath)) {
            New-Item -Path $parentPath -Force | Out-Null
        }

        if (-not (Test-Path $RegPath)) {
            New-Item -Path $RegPath -Force | Out-Null
        }

        Set-ItemProperty -Path $RegPath -Name "(Default)" -Value $manifestPath

        Write-Host "[OK] Registered for $BrowserName" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "[SKIP] Could not register for $BrowserName : $_" -ForegroundColor Yellow
        return $false
    }
}

Write-Host ""

# Register for each browser
$registered = 0

if (Register-NativeHost -RegPath $chromeRegPath -BrowserName "Chrome") { $registered++ }
if (Register-NativeHost -RegPath $chromiumRegPath -BrowserName "Chromium") { $registered++ }
if (Register-NativeHost -RegPath $edgeRegPath -BrowserName "Edge") { $registered++ }

Write-Host ""

if ($registered -gt 0) {
    Write-Host "Installation complete! Registered for $registered browser(s)." -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "1. Open chrome://extensions" -ForegroundColor White
    Write-Host "2. Enable 'Developer mode'" -ForegroundColor White
    Write-Host "3. Click 'Load unpacked'" -ForegroundColor White
    Write-Host "4. Select: $extensionDir" -ForegroundColor White
    Write-Host ""
}
else {
    Write-Host "No browsers registered. Please run as Administrator if needed." -ForegroundColor Red
}
