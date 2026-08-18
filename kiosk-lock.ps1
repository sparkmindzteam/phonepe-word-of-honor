# One locked kiosk. Ctrl+Shift+L opens admin. Esc closes admin, Esc again exits.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$port = 5173
$root = $PSScriptRoot
$url = "http://127.0.0.1:$port/?kiosk=1"
$profileDir = Join-Path $env:TEMP "phonepe-kiosk-profile"
$dataDir = Join-Path $root "data"
$scoresJson = Join-Path $dataDir "scores.json"
$scoresCsv = Join-Path $dataDir "scores.csv"
$settingsJson = Join-Path $dataDir "settings.json"
$kioskExitFlag = Join-Path $dataDir "kiosk-exit.flag"
$onlineUrl = "https://phonepe-word-of-honor.vercel.app/api/scores"
$onlineSettingsUrl = "https://phonepe-word-of-honor.vercel.app/api/settings"
$edgeProc = $null
$script:regBackup = @()
$script:listener = $null
$script:serverRunspace = $null
$script:startedServer = $false

function Test-LocalServer {
  try {
    Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 "http://127.0.0.1:$port/" | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Get-Browser {
  $paths = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
  )
  foreach ($p in $paths) { if (Test-Path $p) { return $p } }
  throw "Microsoft Edge or Google Chrome was not found."
}

function Set-RegDword([string]$path, [string]$name, [int]$value) {
  try {
    if (-not (Test-Path $path)) {
      New-Item -Path $path -Force | Out-Null
      $script:regBackup += [pscustomobject]@{ Path = $path; Name = $name; HadValue = $false; Value = $null }
    } else {
      $item = Get-ItemProperty -Path $path -Name $name -ErrorAction SilentlyContinue
      if ($null -eq $item) {
        $script:regBackup += [pscustomobject]@{ Path = $path; Name = $name; HadValue = $false; Value = $null }
      } else {
        $script:regBackup += [pscustomobject]@{ Path = $path; Name = $name; HadValue = $true; Value = $item.$name }
      }
    }
    Set-ItemProperty -Path $path -Name $name -Value $value -Type DWord -Force
  } catch {}
}

function Enable-GestureLock {
  Set-RegDword "HKCU:\Software\Policies\Microsoft\Windows\EdgeUI" "AllowEdgeSwipe" 0
  Set-RegDword "HKCU:\Software\Microsoft\Windows\CurrentVersion\ImmersiveShell\EdgeUI" "AllowEdgeSwipe" 0
  Set-RegDword "HKCU:\Software\Microsoft\Windows\CurrentVersion\ImmersiveShell\EdgeUI" "DisableTLcorner" 1
  Set-RegDword "HKCU:\Software\Microsoft\Windows\CurrentVersion\ImmersiveShell\EdgeUI" "DisableTRcorner" 1
  Set-RegDword "HKCU:\Software\Microsoft\Windows\CurrentVersion\PrecisionTouchPad" "ThreeFingerSlideEnabled" 0
  Set-RegDword "HKCU:\Software\Microsoft\Windows\CurrentVersion\PrecisionTouchPad" "FourFingerSlideEnabled" 0
  Set-RegDword "HKCU:\Software\Microsoft\Windows\CurrentVersion\PrecisionTouchPad" "ThreeFingerTapEnabled" 0
  Set-RegDword "HKCU:\Software\Microsoft\Windows\CurrentVersion\PrecisionTouchPad" "FourFingerTapEnabled" 0
}

function Restore-GestureLock {
  foreach ($item in $script:regBackup) {
    try {
      if ($item.HadValue) { Set-ItemProperty -Path $item.Path -Name $item.Name -Value $item.Value -Force }
      else { Remove-ItemProperty -Path $item.Path -Name $item.Name -ErrorAction SilentlyContinue }
    } catch {}
  }
}

if (-not ("PhonePeKioskLock" -as [type])) {
Add-Type -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class PhonePeKioskLock {
  public static volatile bool ExitRequested = false;
  private static IntPtr _hook = IntPtr.Zero;
  private static LowLevelKeyboardProc _proc = HookProc;
  private const int WH_KEYBOARD_LL = 13;
  private const int WM_KEYDOWN = 0x0100;
  private const int WM_SYSKEYDOWN = 0x0104;
  private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", SetLastError = true)]
  private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);
  [DllImport("user32.dll")]
  private static extern bool UnhookWindowsHookEx(IntPtr hhk);
  [DllImport("user32.dll")]
  private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
  [DllImport("kernel32.dll")]
  private static extern IntPtr GetModuleHandle(string lpModuleName);
  [DllImport("user32.dll")]
  private static extern short GetAsyncKeyState(int vKey);
  [StructLayout(LayoutKind.Sequential)]
  private struct KBDLLHOOKSTRUCT {
    public int vkCode; public int scanCode; public int flags; public int time; public IntPtr dwExtraInfo;
  }
  public static void Install() {
    using (Process cur = Process.GetCurrentProcess())
    using (ProcessModule mod = cur.MainModule) {
      _hook = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(mod.ModuleName), 0);
    }
  }
  public static void Uninstall() {
    if (_hook != IntPtr.Zero) { UnhookWindowsHookEx(_hook); _hook = IntPtr.Zero; }
  }
  private static bool Ctrl() { return (GetAsyncKeyState(0x11) & 0x8000) != 0; }
  private static bool Shift() { return (GetAsyncKeyState(0x10) & 0x8000) != 0; }
  private static IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam) {
    if (nCode >= 0 && (wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN)) {
      KBDLLHOOKSTRUCT info = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
      bool alt = (info.flags & 0x20) != 0;
      int vk = info.vkCode;
      if (vk == 0x5B || vk == 0x5C || vk == 0x7A) return (IntPtr)1;
      if (alt && (vk == 0x09 || vk == 0x73 || vk == 0x1B || vk == 0x25)) return (IntPtr)1;
      if (Ctrl() && vk == 0x1B && !Shift()) return (IntPtr)1;
      if (Ctrl() && (vk == 0x57 || vk == 0x54 || vk == 0x4E || vk == 0x52)) return (IntPtr)1;
    }
    return CallNextHookEx(_hook, nCode, wParam, lParam);
  }
}
"@
}

function Ensure-Data {
  if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }
  if (-not (Test-Path $scoresJson)) { Set-Content -Path $scoresJson -Value "[]" -Encoding UTF8 }
}

function Read-Scores {
  Ensure-Data
  try {
    $raw = Get-Content -Raw -Path $scoresJson -ErrorAction Stop
    $list = $raw | ConvertFrom-Json
    if ($list -is [System.Array]) { return @($list) }
    if ($null -eq $list) { return @() }
    return @($list)
  } catch { return @() }
}

function Write-Scores($list) {
  Ensure-Data
  $arr = @($list)
  $json = $arr | ConvertTo-Json -Depth 8 -Compress
  if ($null -eq $json) { $json = "[]" }
  if ($json[0] -ne "[") { $json = "[$json]" }
  Set-Content -Path $scoresJson -Value $json -Encoding UTF8
  $lines = @("at,name,email,employeeId,score,maxScore,feedback,id")
  foreach ($r in $arr) {
    $esc = {
      param($v)
      $s = [string]$v
      if ($s -match '[",\r\n]') { '"' + ($s.Replace('"','""')) + '"' } else { $s }
    }
    $lines += "$( & $esc $r.at),$( & $esc $r.name),$( & $esc $r.email),$( & $esc $r.employeeId),$($r.score),$($r.maxScore),$( & $esc $r.feedback),$( & $esc $r.id)"
  }
  Set-Content -Path $scoresCsv -Value $lines -Encoding UTF8
}

function Start-LocalServer {
  $listener = [System.Net.HttpListener]::new()
  $listener.Prefixes.Add("http://127.0.0.1:$port/")
  $listener.Start()
  $script:listener = $listener

  $rs = [runspacefactory]::CreateRunspace()
  $rs.Open()
  $rs.SessionStateProxy.SetVariable("listener", $listener)
  $rs.SessionStateProxy.SetVariable("root", $root)
  $rs.SessionStateProxy.SetVariable("scoresJson", $scoresJson)
  $rs.SessionStateProxy.SetVariable("scoresCsv", $scoresCsv)
  $rs.SessionStateProxy.SetVariable("settingsJson", $settingsJson)
  $rs.SessionStateProxy.SetVariable("dataDir", $dataDir)
  $rs.SessionStateProxy.SetVariable("onlineUrl", $onlineUrl)
  $rs.SessionStateProxy.SetVariable("onlineSettingsUrl", $onlineSettingsUrl)
  $rs.SessionStateProxy.SetVariable("kioskExitFlag", $kioskExitFlag)
  $ps = [powershell]::Create()
  $ps.Runspace = $rs
  [void]$ps.AddScript({
    $mime = @{
      ".html"="text/html; charset=utf-8"; ".js"="text/javascript; charset=utf-8"
      ".css"="text/css; charset=utf-8"; ".json"="application/json; charset=utf-8"
      ".png"="image/png"; ".otf"="font/otf"; ".woff2"="font/woff2"; ".svg"="image/svg+xml"
    }
    $lock = New-Object object
    function LoadScores {
      try {
        if (-not (Test-Path $scoresJson)) { return @() }
        $x = (Get-Content -Raw $scoresJson) | ConvertFrom-Json
        if ($null -eq $x) { return @() }
        return @($x)
      } catch { return @() }
    }
    function SaveScores($list) {
      if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }
      $arr = @($list)
      $json = $arr | ConvertTo-Json -Depth 8
      if ($null -eq $json) { $json = "[]" }
      Set-Content -Path $scoresJson -Value $json -Encoding UTF8
      $csv = @("at,name,email,score,maxScore,feedback,id")
      foreach ($r in $arr) {
        $csv += "$($r.at),$($r.name),$($r.email),$($r.score),$($r.maxScore),$($r.feedback),$($r.id)"
      }
      Set-Content -Path $scoresCsv -Value $csv -Encoding UTF8
    }
    function WriteResponse($ctx, $code, $ctype, $bytes) {
      $ctx.Response.StatusCode = $code
      $ctx.Response.ContentType = $ctype
      $ctx.Response.Headers["Cache-Control"] = "no-store"
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      $ctx.Response.OutputStream.Close()
    }
    function WriteJson($ctx, $code, $obj) {
      $bytes = [Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Depth 8 -Compress))
      WriteResponse $ctx $code "application/json; charset=utf-8" $bytes
    }
    while ($listener.IsListening) {
      try { $ctx = $listener.GetContext() } catch { break }
      try {
        $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
        if ($path -eq "/") { $path = "/index.html" }
        if ($path -eq "/admin" -or $path -eq "/admin/") { $path = "/admin.html" }
        if ($ctx.Request.HttpMethod -eq "OPTIONS") {
          $ctx.Response.StatusCode = 204
          $ctx.Response.Headers["Access-Control-Allow-Origin"] = "*"
          $ctx.Response.Close(); continue
        }
        if ($path -eq "/api/scores" -or $path -eq "/api/scores/") {
          if ($ctx.Request.HttpMethod -eq "GET") {
            [void][System.Threading.Monitor]::Enter($lock)
            try { $scores = LoadScores } finally { [System.Threading.Monitor]::Exit($lock) }
            WriteJson $ctx 200 @{ ok = $true; scores = @($scores); source = "local-file" }
            continue
          }
          if ($ctx.Request.HttpMethod -eq "POST") {
            $reader = New-Object IO.StreamReader($ctx.Request.InputStream, $ctx.Request.ContentEncoding)
            $raw = $reader.ReadToEnd(); $reader.Close()
            $body = $raw | ConvertFrom-Json
            if (-not $body.name -and -not $body.email) {
              WriteJson $ctx 400 @{ ok = $false; error = "name or email required" }
              continue
            }
            $rec = [ordered]@{
              id = [string]$body.id
              name = [string]$body.name
              employeeId = [string]$body.employeeId
              email = [string]$body.email
              score = [int]$body.score
              maxScore = [int]$body.maxScore
              feedback = [string]$body.feedback
              at = [string]$body.at
              savedLocal = $true
              savedOnline = $false
            }
            [void][System.Threading.Monitor]::Enter($lock)
            try {
              $scores = @(LoadScores)
              if ($rec.id -and ($scores | Where-Object { $_.id -eq $rec.id })) { }
              else { $scores += (New-Object psobject -Property $rec); SaveScores $scores }
            } finally { [System.Threading.Monitor]::Exit($lock) }
            $onlineOk = $false
            try {
              $payload = @{
                id=$rec.id; name=$rec.name; employeeId=$rec.employeeId; email=$rec.email
                score=$rec.score; maxScore=$rec.maxScore; feedback=$rec.feedback; at=$rec.at; rounds=@()
              } | ConvertTo-Json -Compress
              Invoke-RestMethod -Method Post -Uri $onlineUrl -ContentType "application/json" -Body $payload -TimeoutSec 12 | Out-Null
              $onlineOk = $true
            } catch {}
            WriteJson $ctx 201 @{ ok = $true; savedLocal = $true; savedOnline = $onlineOk }
            continue
          }
        }
        if ($path -eq "/api/settings" -or $path -eq "/api/settings/") {
          function LoadSettingsFile {
            try {
              if (Test-Path $settingsJson) {
                $s = (Get-Content -Raw $settingsJson) | ConvertFrom-Json
                if ($s) { return $s }
              }
            } catch {}
            return $null
          }
          if ($ctx.Request.HttpMethod -eq "GET") {
            [void][System.Threading.Monitor]::Enter($lock)
            try { $settings = LoadSettingsFile } finally { [System.Threading.Monitor]::Exit($lock) }
            if (-not $settings) {
              try { $settings = Invoke-RestMethod -Method Get -Uri $onlineSettingsUrl -TimeoutSec 8 } catch {}
              if ($settings.settings) { $settings = $settings.settings }
            }
            if (-not $settings) {
              $settings = @{ keyboardMode = "both"; quizSeconds = 30; wordFindSeconds = 20; idleResetSeconds = 7 }
            }
            WriteJson $ctx 200 @{ ok = $true; settings = $settings; source = "shared" }
            continue
          }
          if ($ctx.Request.HttpMethod -eq "POST") {
            $reader = New-Object IO.StreamReader($ctx.Request.InputStream, $ctx.Request.ContentEncoding)
            $raw = $reader.ReadToEnd(); $reader.Close()
            $body = $raw | ConvertFrom-Json
            $settings = @{
              keyboardMode = [string]$body.keyboardMode
              quizSeconds = [int]$body.quizSeconds
              wordFindSeconds = [int]$body.wordFindSeconds
              idleResetSeconds = [int]$body.idleResetSeconds
            }
            [void][System.Threading.Monitor]::Enter($lock)
            try {
              if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }
              Set-Content -Path $settingsJson -Value ($settings | ConvertTo-Json -Compress) -Encoding UTF8
            } finally { [System.Threading.Monitor]::Exit($lock) }
            try {
              Invoke-RestMethod -Method Post -Uri $onlineSettingsUrl -ContentType "application/json" -Body ($settings | ConvertTo-Json -Compress) -TimeoutSec 12 | Out-Null
            } catch {}
            WriteJson $ctx 200 @{ ok = $true; settings = $settings }
            continue
          }
        }
        if (($path -eq "/api/kiosk/exit" -or $path -eq "/api/kiosk/exit/") -and $ctx.Request.HttpMethod -eq "POST") {
          Set-Content -Path $kioskExitFlag -Value "1" -Encoding ASCII
          WriteJson $ctx 200 @{ ok = $true }
          continue
        }
        $rel = $path.TrimStart("/").Replace("/", [IO.Path]::DirectorySeparatorChar)
        $full = [IO.Path]::GetFullPath((Join-Path $root $rel))
        if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $full -PathType Leaf)) {
          WriteJson $ctx 404 @{ ok = $false }
          continue
        }
        $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()
        $ctype = $mime[$ext]; if (-not $ctype) { $ctype = "application/octet-stream" }
        $bytes = [IO.File]::ReadAllBytes($full)
        WriteResponse $ctx 200 $ctype $bytes
      } catch {
        try { $ctx.Response.StatusCode = 500; $ctx.Response.Close() } catch {}
      }
    }
  })
  $script:serverRunspace = $rs
  [void]$ps.BeginInvoke()
  $script:startedServer = $true
}

function Stop-LocalServer {
  try { if ($script:listener -and $script:listener.IsListening) { $script:listener.Stop(); $script:listener.Close() } } catch {}
  try { if ($script:serverRunspace) { $script:serverRunspace.Close(); $script:serverRunspace.Dispose() } } catch {}
}

function Stop-KioskBrowser {
  if ($edgeProc -and -not $edgeProc.HasExited) {
    try { Stop-Process -Id $edgeProc.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*phonepe-kiosk-profile*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

try {
  Ensure-Data
  Remove-Item $kioskExitFlag -ErrorAction SilentlyContinue
  $browser = Get-Browser
  Write-Host "Starting locked kiosk..."
  Write-Host "Ctrl+Shift+L opens admin. Esc closes admin. Esc again exits kiosk."
  Enable-GestureLock
  if (-not (Test-LocalServer)) { Start-LocalServer; Start-Sleep -Milliseconds 400 }
  $browserArgs = @(
    "--kiosk", $url,
    "--edge-kiosk-type=fullscreen",
    "--no-first-run",
    "--disable-pinch",
    "--overscroll-history-navigation=0",
    "--disable-features=OverscrollHistoryNavigation,TouchpadOverscrollHistoryNavigation,TranslateUI",
    "--user-data-dir=$profileDir"
  )
  $edgeProc = Start-Process -FilePath $browser -ArgumentList $browserArgs -PassThru
  [PhonePeKioskLock]::Install()
  while (-not [PhonePeKioskLock]::ExitRequested) {
    if ($edgeProc -and $edgeProc.HasExited) { break }
    if (Test-Path $kioskExitFlag) { break }
    Start-Sleep -Milliseconds 150
  }
}
catch {
  Write-Host ""
  Write-Host "ERROR: $($_.Exception.Message)"
  Write-Host $_.ScriptStackTrace
  Write-Host ""
  pause
}
finally {
  try { [PhonePeKioskLock]::Uninstall() } catch {}
  Stop-KioskBrowser
  Restore-GestureLock
  if ($script:startedServer) { Stop-LocalServer }
  Remove-Item $kioskExitFlag -ErrorAction SilentlyContinue
  Write-Host "Kiosk unlocked."
}
