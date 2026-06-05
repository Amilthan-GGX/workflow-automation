# One-time sync: copy Chrome profile into project automation dir (Windows).
# Quit Chrome before running: npm run chrome:sync-profile
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

$Profile = Read-EnvVar "BROWSER_CHROME_PROFILE"; if (-not $Profile) { $Profile = "Default" }
$Allowlist = Read-EnvVar "BROWSER_CHROME_PROFILE_ALLOWLIST"; if (-not $Allowlist) { $Allowlist = "Default" }
$DstRoot = Read-EnvVar "BROWSER_CHROME_USER_DATA_DIR"
if (-not $DstRoot) { $DstRoot = Join-Path $Root "storage\browser\chrome-cdp-data" }
if (-not [System.IO.Path]::IsPathRooted($DstRoot)) { $DstRoot = Join-Path $Root $DstRoot }

if ($Allowlist -notmatch [regex]::Escape($Profile)) {
    Write-Error "Refusing to sync profile `"$Profile`" — not in allowlist ($Allowlist)"
}

$Src = Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data\$Profile"
$Dst = Join-Path $DstRoot $Profile

if (Get-Process -Name "chrome" -ErrorAction SilentlyContinue) {
    Write-Error "Quit Google Chrome completely, then run again."
}

if (-not (Test-Path $Src)) {
    Write-Error "Source profile not found: $Src"
}

New-Item -ItemType Directory -Force -Path $DstRoot | Out-Null
if (Test-Path $Dst) { Remove-Item -Recurse -Force $Dst }
Write-Host "Syncing Chrome profile `"$Profile`" ..."
Copy-Item -Recurse -Force $Src $Dst
Write-Host "Done: $Dst"
Write-Host "Next: npm run chrome:cdp (terminal 1), then npm run process:digitify"
