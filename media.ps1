# Now-playing helper. Reads the Windows system media session (SMTC) and prints
# one JSON line to stdout whenever something changes. Accepts commands on stdin:
# "toggle", "next", "prev", "seek <ms>".

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null

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

$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) `
  ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

# PowerShell can't bind the WinRT stream (a bare COM object) to AsStreamForRead
# directly; invoking through reflection performs the interface cast for us.
$asStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethod(
  'AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream]))

function Get-Thumbnail($ref) {
  if (-not $ref) { return $null }
  try {
    $stream = Await ($ref.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $netStream = $asStreamForRead.Invoke($null, @($stream))
    $ms = New-Object System.IO.MemoryStream
    $netStream.CopyTo($ms)
    $bytes = $ms.ToArray()
    $netStream.Dispose(); $ms.Dispose()
    if ($bytes.Length -eq 0) { return $null }
    # ContentType isn't readable either, so sniff the header.
    $type = if ($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xD8) { 'image/jpeg' } else { 'image/png' }
    return "data:$type;base64," + [Convert]::ToBase64String($bytes)
  } catch { return $null }
}

function Send($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}

$lastTrackKey = $null
$lastThumb = $null
$lastJson = $null
$trackChangedAt = [DateTime]::MinValue
$lastThumbCheck = [DateTime]::MinValue

# Windows' "current session" can be a paused browser tab while Spotify plays,
# so prefer whichever session is actually playing.
function Get-ActiveSession {
  $current = $manager.GetCurrentSession()
  if ($current -and $current.GetPlaybackInfo().PlaybackStatus -eq 'Playing') { return $current }
  foreach ($s in $manager.GetSessions()) {
    if ($s.GetPlaybackInfo().PlaybackStatus -eq 'Playing') { return $s }
  }
  return $current
}
# [Console]::In.ReadLineAsync() blocks in PowerShell 5.1; a StreamReader doesn't.
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)
$pending = $stdin.ReadLineAsync()

while ($true) {
  # Handle any commands that arrived.
  while ($pending.IsCompleted) {
    $cmd = $pending.Result
    if ($null -eq $cmd) { exit 0 }  # stdin closed: parent is gone
    $session = Get-ActiveSession
    if ($session) {
      try {
        $parts = $cmd.Trim().Split(' ')
        switch ($parts[0]) {
          'toggle' { Await ($session.TryTogglePlayPauseAsync()) ([bool]) | Out-Null }
          'next'   { Await ($session.TrySkipNextAsync()) ([bool]) | Out-Null }
          'prev'   { Await ($session.TrySkipPreviousAsync()) ([bool]) | Out-Null }
          # Position in ms; the API takes 100ns ticks.
          'seek'   { Await ($session.TryChangePlaybackPositionAsync([long]$parts[1] * 10000)) ([bool]) | Out-Null }
        }
      } catch {}
    }
    $pending = $stdin.ReadLineAsync()
  }

  $state = @{ type = 'state'; active = $false }
  try {
    $session = Get-ActiveSession
    if ($session) {
      $props = Await ($session.TryGetMediaPropertiesAsync()) `
        ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $info = $session.GetPlaybackInfo()
      $timeline = $session.GetTimelineProperties()

      # Artwork is large, so it goes out as its own message only when it changes.
      # Browsers update the title before the artwork, so a single read at the
      # track change can return the previous video's image. Keep re-reading
      # often for a few seconds after a change, then occasionally.
      $now = [DateTime]::UtcNow
      $trackKey = "$($session.SourceAppUserModelId)|$($props.Title)|$($props.Artist)"
      if ($trackKey -ne $lastTrackKey) {
        $lastTrackKey = $trackKey
        $trackChangedAt = $now
        $lastThumbCheck = [DateTime]::MinValue
      }
      $settling = ($now - $trackChangedAt).TotalSeconds -lt 8
      $interval = if ($settling) { 0 } else { 3 }
      if (($now - $lastThumbCheck).TotalSeconds -ge $interval) {
        $lastThumbCheck = $now
        $thumb = Get-Thumbnail $props.Thumbnail
        if ($thumb -ne $lastThumb) {
          $lastThumb = $thumb
          Send @{ type = 'artwork'; data = $thumb }
        }
      }

      $state = @{
        type        = 'state'
        active      = $true
        app         = $session.SourceAppUserModelId
        title       = $props.Title
        artist      = $props.Artist
        album       = $props.AlbumTitle
        status      = $info.PlaybackStatus.ToString()
        canPrev     = $info.Controls.IsPreviousEnabled
        canNext     = $info.Controls.IsNextEnabled
        canToggle   = $info.Controls.IsPlayPauseToggleEnabled
        canSeek     = $info.Controls.IsPlaybackPositionEnabled
        # All apps playing right now (e.g. Spotify AND a YouTube tab), so the
        # Now Playing screen can tell if one of them is the window you're watching.
        playingApps = @($manager.GetSessions() | Where-Object { $_.GetPlaybackInfo().PlaybackStatus -eq 'Playing' } | ForEach-Object { $_.SourceAppUserModelId })
        positionMs  = [long]$timeline.Position.TotalMilliseconds
        durationMs  = [long]$timeline.EndTime.TotalMilliseconds
        updatedAtMs = $timeline.LastUpdatedTime.ToUnixTimeMilliseconds()
      }
    }
  } catch {
    $state = @{ type = 'state'; active = $false }
  }

  $json = $state | ConvertTo-Json -Compress
  if ($json -ne $lastJson) {
    $lastJson = $json
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
  }

  # Wakes early when a command arrives, so the buttons feel instant.
  $pending.Wait(400) | Out-Null
}
