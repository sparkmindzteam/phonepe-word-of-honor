# Locked kiosk: fullscreen Edge, block back/home/gestures until Escape.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$port = 5173
$url = "http://127.0.0.1:$port/?kiosk=1"
$profileDir = Join-Path $env:TEMP "phonepe-kiosk-profile"
$pythonProc = $null
$edgeProc = $null
$hook = $null
$script:regBackup = @()

function Get-Python {
  if (Get-Command py -ErrorAction SilentlyContinue) { return @("py", "-3") }
  if (Get-Command python -ErrorAction SilentlyContinue) { return @("python") }
  throw "Python 3 is required. Install it and tick 'Add Python to PATH'."
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
  if (-not (Test-Path $path)) {
    New-Item -Path $path -Force | Out-Null
    $script:regBackup += [pscustomobject]@{ Path = $path; Name = $name; HadValue = $false; Value = $null; CreatedKey = $true }
  } else {
    $item = Get-ItemProperty -Path $path -Name $name -ErrorAction SilentlyContinue
    if ($null -eq $item) {
      $script:regBackup += [pscustomobject]@{ Path = $path; Name = $name; HadValue = $false; Value = $null; CreatedKey = $false }
    } else {
      $script:regBackup += [pscustomobject]@{ Path = $path; Name = $name; HadValue = $true; Value = $item.$name; CreatedKey = $false }
    }
  }
  Set-ItemProperty -Path $path -Name $name -Value $value -Type DWord -Force
}

function Enable-GestureLock {
  try { Set-RegDword "HKCU:\Software\Policies\Microsoft\Windows\EdgeUI" "AllowEdgeSwipe" 0 } catch {}
  try { Set-RegDword "HKCU:\Software\Microsoft\Windows\CurrentVersion\ImmersiveShell\EdgeUI" "AllowEdgeSwipe" 0 } catch {}
  try { Set-RegDword "HKCU:\Software\Microsoft\Windows\CurrentVersion\ImmersiveShell\EdgeUI" "DisableTLcorner" 1 } catch {}
  try { Set-RegDword "HKCU:\Software\Microsoft\Windows\CurrentVersion\ImmersiveShell\EdgeUI" "DisableTRcorner" 1 } catch {}
  try { Set-RegDword "HKCU:\Software\Microsoft\Windows\CurrentVersion\PrecisionTouchPad" "ThreeFingerSlideEnabled" 0 } catch {}
  try { Set-RegDword "HKCU:\Software\Microsoft\Windows\CurrentVersion\PrecisionTouchPad" "FourFingerSlideEnabled" 0 } catch {}
  try { Set-RegDword "HKCU:\Software\Microsoft\Windows\CurrentVersion\PrecisionTouchPad" "ThreeFingerTapEnabled" 0 } catch {}
  try { Set-RegDword "HKCU:\Software\Microsoft\Windows\CurrentVersion\PrecisionTouchPad" "FourFingerTapEnabled" 0 } catch {}
  try { Set-RegDword "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced" "MultiFingerGestures" 0 } catch {}
  try { Set-RegDword "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced" "EnableBalloonTips" 0 } catch {}
  try { Set-RegDword "HKCU:\Software\Policies\Microsoft\Windows\Explorer" "DisableBacktracking" 1 } catch {}
}

function Restore-GestureLock {
  foreach ($item in $script:regBackup) {
    try {
      if ($item.HadValue) {
        Set-ItemProperty -Path $item.Path -Name $item.Name -Value $item.Value -Force
      } else {
        Remove-ItemProperty -Path $item.Path -Name $item.Name -ErrorAction SilentlyContinue
      }
    } catch {}
  }
}

$code = @"
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
  private const int VK_TAB = 0x09;
  private const int VK_ESCAPE = 0x1B;
  private const int VK_F4 = 0x73;
  private const int VK_F11 = 0x7A;
  private const int VK_LWIN = 0x5B;
  private const int VK_RWIN = 0x5C;
  private const int VK_LEFT = 0x25;
  private const int LLKHF_ALTDOWN = 0x20;

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
    public int vkCode;
    public int scanCode;
    public int flags;
    public int time;
    public IntPtr dwExtraInfo;
  }

  public static void Install() {
    using (Process cur = Process.GetCurrentProcess())
    using (ProcessModule mod = cur.MainModule) {
      _hook = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(mod.ModuleName), 0);
    }
  }

  public static void Uninstall() {
    if (_hook != IntPtr.Zero) {
      UnhookWindowsHookEx(_hook);
      _hook = IntPtr.Zero;
    }
  }

  private static bool Ctrl() { return (GetAsyncKeyState(0x11) & 0x8000) != 0; }
  private static bool Shift() { return (GetAsyncKeyState(0x10) & 0x8000) != 0; }

  private static IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam) {
    if (nCode >= 0 && (wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN)) {
      KBDLLHOOKSTRUCT info = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
      bool alt = (info.flags & LLKHF_ALTDOWN) != 0;
      int vk = info.vkCode;

      if (vk == VK_ESCAPE && !Ctrl() && !alt) {
        ExitRequested = true;
        return (IntPtr)1;
      }
      if (vk == VK_LWIN || vk == VK_RWIN) return (IntPtr)1;
      if (vk == VK_F11) return (IntPtr)1;
      if (alt && vk == VK_TAB) return (IntPtr)1;
      if (alt && vk == VK_F4) return (IntPtr)1;
      if (alt && vk == VK_ESCAPE) return (IntPtr)1;
      if (alt && vk == VK_LEFT) return (IntPtr)1;
      if (Ctrl() && vk == VK_ESCAPE) return (IntPtr)1;
      if (Ctrl() && Shift() && vk == VK_ESCAPE) return (IntPtr)1;
      if (Ctrl() && (vk == 0x57 || vk == 0x54 || vk == 0x4E || vk == 0x52)) return (IntPtr)1; // W T N R
    }
    return CallNextHookEx(_hook, nCode, wParam, lParam);
  }
}
"@

Add-Type -TypeDefinition $code -ErrorAction Stop

function Wait-Server {
  for ($i = 0; $i -lt 40; $i++) {
    try {
      $ok = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 "http://127.0.0.1:$port/" 
      if ($ok.StatusCode -ge 200) { return }
    } catch {}
    Start-Sleep -Milliseconds 250
  }
  throw "Local server did not start on port $port."
}

function Stop-KioskProcesses {
  if ($edgeProc -and -not $edgeProc.HasExited) {
    try { Stop-Process -Id $edgeProc.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*phonepe-kiosk-profile*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  if ($pythonProc -and -not $pythonProc.HasExited) {
    try { Stop-Process -Id $pythonProc.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*local-server.py*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

try {
  Write-Host "Locking Word of Honor in kiosk mode..."
  Write-Host "Press ESC to unlock and exit."
  Enable-GestureLock

  $py = Get-Python
  if ($py.Count -gt 1) {
    $pythonProc = Start-Process -FilePath $py[0] -ArgumentList @($py[1], "local-server.py") -PassThru -WindowStyle Hidden
  } else {
    $pythonProc = Start-Process -FilePath $py[0] -ArgumentList @("local-server.py") -PassThru -WindowStyle Hidden
  }
  Wait-Server

  $browser = Get-Browser
  $args = @(
    "--kiosk", $url,
    "--edge-kiosk-type=fullscreen",
    "--kiosk-type=fullscreen",
    "--no-first-run",
    "--disable-pinch",
    "--overscroll-history-navigation=0",
    "--disable-features=OverscrollHistoryNavigation,TouchpadOverscrollHistoryNavigation,TranslateUI",
    "--user-data-dir=$profileDir"
  )
  $edgeProc = Start-Process -FilePath $browser -ArgumentList $args -PassThru

  [PhonePeKioskLock]::Install()
  while (-not [PhonePeKioskLock]::ExitRequested) {
    if ($edgeProc -and $edgeProc.HasExited) { break }
    Start-Sleep -Milliseconds 150
  }
}
finally {
  try { [PhonePeKioskLock]::Uninstall() } catch {}
  Stop-KioskProcesses
  Restore-GestureLock
  Write-Host "Kiosk unlocked."
}
