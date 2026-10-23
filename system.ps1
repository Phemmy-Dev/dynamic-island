# System helper. Reports volume, battery, brightness, Wi-Fi/Bluetooth radios,
# the network, and which app window sits under the island, as JSON lines on
# change. Accepts commands on stdin:
#   "volume <0..1>", "mute", "brightness <0..100>", "radio <wifi|bluetooth> <on|off>",
#   "focus <process name>"


$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms

# Core Audio (IAudioEndpointVolume) for the default playback device.
# Unused vtable slots are stubbed (f, g, ...) so the method order matches.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown), ComImport]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float level, Guid context);
  int j();
  int GetMasterVolumeLevelScalar(out float level);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid context);
  int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown), ComImport]
interface IMMDevice {
  int Activate(ref Guid id, int clsCtx, IntPtr activationParams, out IAudioEndpointVolume endpointVolume);
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown), ComImport]
interface IMMDeviceEnumerator {
  int f();
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorComObject { }

public static class IslandAudio {
  // Looked up every call so switching to headphones etc. is picked up.
  static IAudioEndpointVolume Endpoint() {
    var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
    IMMDevice device;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0 /* render */, 1 /* multimedia */, out device));
    IAudioEndpointVolume volume;
    Guid iid = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23 /* CLSCTX_ALL */, IntPtr.Zero, out volume));
    return volume;
  }

  public static float GetVolume() { float v; Marshal.ThrowExceptionForHR(Endpoint().GetMasterVolumeLevelScalar(out v)); return v; }
  public static void SetVolume(float v) { Marshal.ThrowExceptionForHR(Endpoint().SetMasterVolumeLevelScalar(v, Guid.Empty)); }
  public static bool GetMute() { bool m; Marshal.ThrowExceptionForHR(Endpoint().GetMute(out m)); return m; }
  public static void SetMute(bool m) { Marshal.ThrowExceptionForHR(Endpoint().SetMute(m, Guid.Empty)); }
}
'@

# Finds the app window (if any) sitting under the island, so the island can
# tuck itself away instead of covering e.g. a maximized browser's tabs.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class IslandWindows {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr hwnd);

  // True when the app in front covers the whole screen (full-screen video,
  // game, slideshow). Maximized windows don't count: with an auto-hiding
  // taskbar they cover the screen too, but they're ordinary windows.
  public static bool ForegroundIsFullscreen(uint ownPid, int left, int top, int right, int bottom) {
    IntPtr hwnd = GetForegroundWindow();
    if (hwnd == IntPtr.Zero || IsZoomed(hwnd)) return false;
    uint pid;
    GetWindowThreadProcessId(hwnd, out pid);
    if (pid == ownPid) return false;
    var name = new StringBuilder(256);
    GetClassName(hwnd, name, 256);
    if (Array.IndexOf(Ignored, name.ToString()) >= 0) return false;
    RECT r;
    GetWindowRect(hwnd, out r);
    return r.Left <= left && r.Top <= top && r.Right >= right && r.Bottom >= bottom;
  }

  // Brings the first titled, unowned, on-screen window of these processes to
  // the front (restoring it if minimized). False if they have none.
  // Allowed because this helper was started by the island, which is the
  // foreground app right after you click it.
  public static bool Focus(uint[] pids) {
    IntPtr target = IntPtr.Zero;
    EnumWindows((hwnd, lParam) => {
      if (!IsWindowVisible(hwnd) || GetWindow(hwnd, 4 /* GW_OWNER */) != IntPtr.Zero || GetWindowTextLength(hwnd) == 0) return true;
      uint pid;
      GetWindowThreadProcessId(hwnd, out pid);
      if (Array.IndexOf(pids, pid) < 0) return true;
      int cloaked;
      if (DwmGetWindowAttribute(hwnd, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      target = hwnd;
      return false;
    }, IntPtr.Zero);
    if (target == IntPtr.Zero) return false;
    if (IsIconic(target)) ShowWindow(target, 9 /* SW_RESTORE */);
    SetForegroundWindow(target);
    return true;
  }

  [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }

  // Desktop and taskbar don't count as covering the island.
  static readonly string[] Ignored = { "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd" };

  // Process id of the first real window (top of the Z-order down) that
  // contains any of the points, or 0 if only the desktop is there.
  public static uint WindowAt(uint ownPid, int[] xs, int y) {
    uint found = 0;
    EnumWindows((hwnd, lParam) => {
      if (!IsWindowVisible(hwnd) || IsIconic(hwnd)) return true;
      uint pid;
      GetWindowThreadProcessId(hwnd, out pid);
      if (pid == ownPid) return true;
      int exStyle = GetWindowLong(hwnd, -20);
      if ((exStyle & 0x80) != 0 || (exStyle & 0x20) != 0) return true;  // tool windows, click-through overlays
      int cloaked;
      if (DwmGetWindowAttribute(hwnd, 14, out cloaked, 4) == 0 && cloaked != 0) return true;  // hidden UWP/virtual-desktop windows
      var name = new StringBuilder(256);
      GetClassName(hwnd, name, 256);
      string cls = name.ToString();
      if (Array.IndexOf(Ignored, cls) >= 0) return true;
      RECT r;
      GetWindowRect(hwnd, out r);
      foreach (int x in xs) {
        if (x >= r.Left && x < r.Right && y >= r.Top && y < r.Bottom) { found = pid; return false; }
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@

# Work in physical pixels so window rects and screen bounds agree at any scaling.
[IslandWindows]::SetProcessDPIAware() | Out-Null
$ownPid = if ($env:ISLAND_PID) { [uint32]$env:ISLAND_PID } else { [uint32]0 }

$processNames = @{}  # pid -> process name cache

# Lower-case process name (e.g. "brave", "zoom", "explorer") of the app
# window under the island, or $null.
function Get-CoveredBy {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $cx = $b.X + [int]($b.Width / 2)
  # Sample the middle and both wings, just below the top edge.
  $windowPid = [IslandWindows]::WindowAt($ownPid, [int[]]@(($cx - 150), $cx, ($cx + 150)), $b.Y + 4)
  if ($windowPid -eq 0) { return $null }
  if (-not $processNames.ContainsKey($windowPid)) {
    try { $processNames[$windowPid] = [System.Diagnostics.Process]::GetProcessById($windowPid).ProcessName.ToLower() }
    catch { return $null }
  }
  return $processNames[$windowPid]
}

# ---------- WinRT: radios and network ----------

Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime] | Out-Null
[Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime] | Out-Null
[Windows.Devices.Bluetooth.BluetoothDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime] | Out-Null
[Windows.Devices.Bluetooth.BluetoothLEDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime] | Out-Null
[Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType = WindowsRuntime] | Out-Null

# PowerShell 5.1 can't await WinRT async operations directly; go through AsTask.
$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1

function Await($op, [Type]$resultType) {
  $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}

$radiosAllowed = $false
try {
  $radiosAllowed = (Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])) -eq 'Allowed'
} catch {}

$radios = @()
$radiosFetchedAt = [DateTime]::MinValue

# Radio objects for Wi-Fi and Bluetooth, refetched now and then in case an
# adapter appears or disappears.
function Get-RadioMap {
  if (-not $radiosAllowed) { return @{} }
  if (([DateTime]::UtcNow - $script:radiosFetchedAt).TotalSeconds -gt 15) {
    $script:radiosFetchedAt = [DateTime]::UtcNow
    try {
      $script:radios = @(Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) `
        ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]]))
    } catch { $script:radios = @() }
  }
  $map = @{}
  foreach ($r in $script:radios) {
    if ($r.Kind -eq 'WiFi' -and -not $map.wifi) { $map.wifi = $r }
    if ($r.Kind -eq 'Bluetooth' -and -not $map.bluetooth) { $map.bluetooth = $r }
  }
  return $map
}

function Set-Radio($kind, $on) {
  $radio = (Get-RadioMap)[$kind]
  if (-not $radio) { return }
  $target = if ($on) { [Windows.Devices.Radios.RadioState]::On } else { [Windows.Devices.Radios.RadioState]::Off }
  Await ($radio.SetStateAsync($target)) ([Windows.Devices.Radios.RadioAccessStatus]) | Out-Null
}

# Radio state is "On", "Off" or "Disabled" (airplane mode / hardware switch).
function Get-Radios {
  $map = Get-RadioMap
  return @{
    wifi      = if ($map.wifi) { $map.wifi.State.ToString() } else { $null }
    bluetooth = if ($map.bluetooth) { $map.bluetooth.State.ToString() } else { $null }
  }
}

function Get-Network {
  $p = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
  if (-not $p) { return @{ type = 'none' } }
  $level = $p.GetNetworkConnectivityLevel().ToString()
  if ($p.IsWlanConnectionProfile) {
    return @{ type = 'wifi'; name = $p.WlanConnectionProfileDetails.GetConnectedSsid(); level = $level }
  }
  return @{ type = 'wired'; name = $p.ProfileName; level = $level }
}

# Names of connected Bluetooth devices (classic, e.g. headphones, and Low Energy,
# e.g. mice and watches), sorted so the list only "changes" when a device does.
function Get-BluetoothDevices {
  $names = @()
  foreach ($type in [Windows.Devices.Bluetooth.BluetoothDevice], [Windows.Devices.Bluetooth.BluetoothLEDevice]) {
    $selector = $type::GetDeviceSelectorFromConnectionStatus([Windows.Devices.Bluetooth.BluetoothConnectionStatus]::Connected)
    $found = Await ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($selector)) ([Windows.Devices.Enumeration.DeviceInformationCollection])
    $names += @($found | ForEach-Object { $_.Name } | Where-Object { $_ })
  }
  return @($names | Sort-Object -Unique)
}

# ---------- Brightness (built-in displays only) ----------

$brightnessSupported = $true

function Get-Brightness {
  if (-not $script:brightnessSupported) { return $null }
  try {
    return [int](Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness -ErrorAction Stop |
      Select-Object -First 1).CurrentBrightness
  } catch {
    # External monitors don't expose this; stop asking.
    $script:brightnessSupported = $false
    return $null
  }
}

function Set-Brightness([int]$level) {
  if (-not $script:brightnessSupported) { return }
  Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop |
    Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{ Timeout = 0; Brightness = [byte]$level } | Out-Null
}

# ---------- Battery ----------

function Get-Battery {
  $p = [System.Windows.Forms.SystemInformation]::PowerStatus
  $flags = [int]$p.BatteryChargeStatus
  if ($flags -band 128) { return @{ present = $false } }  # NoSystemBattery
  return @{
    present      = $true
    percent      = [int][Math]::Round($p.BatteryLifePercent * 100)
    charging     = [bool]($flags -band 8)
    pluggedIn    = $p.PowerLineStatus -eq 'Online'
    remainingSec = $p.BatteryLifeRemaining  # -1 when unknown or plugged in
  }
}

# [Console]::In.ReadLineAsync() blocks in PowerShell 5.1; a StreamReader doesn't.
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)
$pending = $stdin.ReadLineAsync()
$lastJson = $null
$loop = 0
$slow = @{}

while ($true) {
  # Brightness commands arrive in bursts while dragging the slider; only the
  # newest one is applied.
  $brightnessTarget = $null
  $refreshSlow = $false

  while ($pending.IsCompleted) {
    $cmd = $pending.Result
    if ($null -eq $cmd) { exit 0 }  # stdin closed: parent is gone
    try {
      $parts = $cmd.Trim().Split(' ')
      switch ($parts[0]) {
        'brightness' { $brightnessTarget = [Math]::Max(0, [Math]::Min(100, [int]$parts[1])) }
        # Bring an app to the front by process name (the "open what's playing" click).
        'focus' {
          $procs = @(Get-Process -Name $cmd.Trim().Substring(6) -ErrorAction SilentlyContinue)
          if ($procs -and -not [IslandWindows]::Focus([uint32[]]@($procs | ForEach-Object { $_.Id }))) {
            # No window on screen (e.g. Spotify closed to the tray): launching it again brings it back.
            $exe = ($procs | Where-Object { $_.Path } | Select-Object -First 1).Path
            if ($exe) { Start-Process $exe }
          }
        }
        'radio' {
          if ($parts[1] -in @('wifi', 'bluetooth')) { Set-Radio $parts[1] ($parts[2] -eq 'on') }
          $refreshSlow = $true
        }
        'volume' {
          # Use double literals: with [Math]::Min(1, $x) PowerShell picks the
          # integer overload and rounds the level to 0 or 1.
          $v = [Math]::Max(0.0, [Math]::Min(1.0, [double]::Parse($parts[1], [Globalization.CultureInfo]::InvariantCulture)))
          [IslandAudio]::SetVolume([float]$v)
          if ($v -gt 0 -and [IslandAudio]::GetMute()) { [IslandAudio]::SetMute($false) }
        }
        'mute' { [IslandAudio]::SetMute(-not [IslandAudio]::GetMute()) }
      }
    } catch {}
    $pending = $stdin.ReadLineAsync()
  }

  if ($null -ne $brightnessTarget) {
    try { Set-Brightness $brightnessTarget } catch {}
    $refreshSlow = $true
  }

  # Brightness, radios and network change rarely: check them every second
  # (5 loops), or right after a command touched them.
  if ($refreshSlow -or $loop % 5 -eq 0) {
    $slow.brightness = Get-Brightness
    try { $slow.radios = Get-Radios } catch { $slow.radios = @{} }
    try { $slow.network = Get-Network } catch { $slow.network = @{ type = 'none' } }
  }
  # Bluetooth devices: every 2 seconds (10 loops); the lookup takes ~0.1s.
  if ($refreshSlow -or $loop % 10 -eq 0) {
    try { $slow.btDevices = Get-BluetoothDevices } catch { $slow.btDevices = @() }
  }
  $loop++

  $state = @{
    type       = 'system'
    battery    = (Get-Battery)
    volume     = $null
    muted      = $false
    brightness = $slow.brightness
    radios     = $slow.radios
    network    = $slow.network
    btDevices  = @($slow.btDevices | Where-Object { $_ })  # PowerShell turns an empty list into $null; drop it
  }
  try {
    $state.volume = [Math]::Round([IslandAudio]::GetVolume(), 2)
    $state.muted = [IslandAudio]::GetMute()
  } catch {}  # no playback device
  try { $state.coveredBy = Get-CoveredBy } catch { $state.coveredBy = $null }
  try {
    $sb = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $state.fullscreen = [IslandWindows]::ForegroundIsFullscreen($ownPid, $sb.Left, $sb.Top, $sb.Right, $sb.Bottom)
  } catch { $state.fullscreen = $false }

  $json = $state | ConvertTo-Json -Compress
  if ($json -ne $lastJson) {
    $lastJson = $json
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
  }

  # Wakes early when a command arrives, so the volume slider feels instant.
  $pending.Wait(200) | Out-Null
}
