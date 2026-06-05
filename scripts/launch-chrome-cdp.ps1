# Launch Chrome with CDP on BROWSER_CDP_PORT (Windows).
# First time: quit Chrome, run npm run chrome:sync-profile
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$EnvFile = Join-Path $Root ".env"

function Read-EnvVar([string]$Key) {
    if (-not (Test-Path $EnvFile)) { return $null }
    $line = Get-Content $EnvFile | Where-Object { $_ -match "^\s*$Key=" } | Select-Object -Last 1
    if (-not $line) { return $null }
    $val = ($line -split '=', 2)[1].Trim()
    if ($val.StartsWith('"') -and $val.EndsWith('"')) { $val = $val.Substring(1, $val.Length - 2) }
    return $val
}

$Port = Read-EnvVar "BROWSER_CDP_PORT"; if (-not $Port) { $Port = "9222" }
$Profile = Read-EnvVar "BROWSER_CHROME_PROFILE"; if (-not $Profile) { $Profile = "Default" }
$Allowlist = Read-EnvVar "BROWSER_CHROME_PROFILE_ALLOWLIST"; if (-not $Allowlist) { $Allowlist = "Default" }
$PaymentUrl = Read-EnvVar "DIGITIFY_BASE_URL"; if (-not $PaymentUrl) { $PaymentUrl = "https://desk.digitify.app/payment" }
$UserData = Read-EnvVar "BROWSER_CHROME_USER_DATA_DIR"
if (-not $UserData) { $UserData = Join-Path $Root "storage\browser\chrome-cdp-data" }
if (-not [System.IO.Path]::IsPathRooted($UserData)) { $UserData = Join-Path $Root $UserData }

$CdpUrl = "http://127.0.0.1:$Port/json/version"
try {
    Invoke-RestMethod -Uri $CdpUrl -TimeoutSec 2 | Out-Null
    Write-Host "CDP already listening on port $Port"
    exit 0
} catch {
    # not running yet
}

if ($Allowlist -notmatch [regex]::Escape($Profile)) {
    Write-Error "Refusing to launch profile '$Profile' - not in allowlist ($Allowlist)"
}

$ProfileDir = Join-Path $UserData $Profile
if (-not (Test-Path $ProfileDir)) {
    Write-Error "Profile not found: $ProfileDir. Run once (Chrome quit): npm run chrome:sync-profile:win"
}

$Chrome = "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $Chrome)) {
    $Chrome = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
}
if (-not (Test-Path $Chrome)) {
    Write-Error "Google Chrome not found. Install Chrome or set path in this script."
}

if (Get-Process -Name "chrome" -ErrorAction SilentlyContinue) {
    Write-Error @"
Chrome is running but CDP is not on port $Port.
Quit ALL Chrome windows (Task Manager -> end every chrome.exe), then run:
  npm run dev
"@
}

Write-Host "Starting Chrome profile '$Profile' with CDP on port $Port..."
Write-Host "User data: $UserData"

$chromeArgs = @(
    "--remote-debugging-port=$Port",
    "--user-data-dir=$UserData",
    "--profile-directory=$Profile",
    "--no-first-run",
    "--no-default-browser-check",
    $PaymentUrl
)
Start-Process -FilePath $Chrome -ArgumentList $chromeArgs
