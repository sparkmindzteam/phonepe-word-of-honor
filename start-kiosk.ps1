$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$port = 5173
Write-Host "Starting Word of Honor locally on port $port..."

$py = $null
$args = @()
if (Get-Command py -ErrorAction SilentlyContinue) {
  $py = "py"
  $args = @("-3", "-u", "local-server.py")
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  $py = "python"
  $args = @("-u", "local-server.py")
} else {
  throw "Python 3 is required. Install it and add it to PATH."
}

$running = $false
try {
  $tcp = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($tcp) { $running = $true }
} catch {}

if (-not $running) {
  Start-Process -WindowStyle Minimized -FilePath $py -ArgumentList $args
  $ok = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 300
    try {
      Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$port/" -TimeoutSec 1 | Out-Null
      $ok = $true
      break
    } catch {}
  }
  if (-not $ok) { throw "Local server did not start on port $port." }
}

$url = "http://127.0.0.1:$port/?kiosk=1"
$admin = "http://127.0.0.1:$port/admin"
Write-Host "Player: $url"
Write-Host "Admin:  $admin"

$edge1 = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
$edge2 = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
$edge = if (Test-Path $edge1) { $edge1 } elseif (Test-Path $edge2) { $edge2 } else { $null }

if (-not $edge) {
  Start-Process $url
  Start-Process $admin
  exit 0
}

Start-Process -FilePath $edge -ArgumentList @("--kiosk", $url)
Start-Process $admin
