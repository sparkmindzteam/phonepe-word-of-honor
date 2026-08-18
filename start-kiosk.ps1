$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$port = 5173
Write-Host "Starting Word of Honor locally on port $port..."

if (Get-Command py -ErrorAction SilentlyContinue) {
  Start-Process -WindowStyle Hidden -FilePath "py" -ArgumentList @("-3", "local-server.py")
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  Start-Process -WindowStyle Hidden -FilePath "python" -ArgumentList @("local-server.py")
} else {
  throw "Python 3 is required. Install it and add it to PATH."
}

Start-Sleep -Milliseconds 800
$url = "http://127.0.0.1:$port/?kiosk=1"
Write-Host "Launching Edge in kiosk mode: $url"

$edge1 = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
$edge2 = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
$edge = if (Test-Path $edge1) { $edge1 } elseif (Test-Path $edge2) { $edge2 } else { $null }

if (-not $edge) {
  Write-Host "Edge not found. Open this URL in your kiosk browser: $url"
  exit 0
}

Start-Process -FilePath $edge -ArgumentList @("--kiosk", $url)
