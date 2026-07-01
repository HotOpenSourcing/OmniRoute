param(
  [string]$CaptureRoot = 'C:\Users\amine\OmniRoute\artifacts\windsurf-native',
  [int]$DurationSeconds = 60,
  [int]$SampleIntervalMs = 250,
  [switch]$UseIsolatedProfile,
  [switch]$SkipNetsh,
  [switch]$AttachOnly,
  [string]$ExistingNetlogPath,
  [string]$ExistingTracePath,
  [string]$WindsurfExe = 'C:\Users\amine\AppData\Local\Programs\Windsurf\Windsurf.exe'
)

$ErrorActionPreference = 'Stop'

function Convert-ToJsonLine {
  param([object]$Value)
  return ($Value | ConvertTo-Json -Depth 8 -Compress)
}

function Write-JsonLine {
  param(
    [string]$Path,
    [object]$Value
  )
  Add-Content -LiteralPath $Path -Value (Convert-ToJsonLine $Value)
}

function Get-WindsurfProcessSnapshot {
  $processes = Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -match '^(Windsurf\.exe|language_server_windows_x64\.exe|devin\.exe)$'
    } |
    Select-Object ProcessId, ParentProcessId, Name, CommandLine, CreationDate

  return @($processes | ForEach-Object {
    [ordered]@{
      pid = $_.ProcessId
      ppid = $_.ParentProcessId
      name = $_.Name
      commandLine = $_.CommandLine
      createdAt = if ($_.CreationDate) {
        try {
          ([Management.ManagementDateTimeConverter]::ToDateTime($_.CreationDate)).ToString('o')
        } catch {
          $null
        }
      } else { $null }
    }
  })
}

function Get-TcpSnapshot {
  $rows = Get-NetTCPConnection -ErrorAction SilentlyContinue |
    Where-Object {
      $_.State -in @('Listen', 'Established')
    } |
    Select-Object State, LocalAddress, LocalPort, RemoteAddress, RemotePort, OwningProcess

  return @($rows | ForEach-Object {
    [ordered]@{
      state = $_.State
      localAddress = $_.LocalAddress
      localPort = $_.LocalPort
      remoteAddress = $_.RemoteAddress
      remotePort = $_.RemotePort
      owningPid = $_.OwningProcess
    }
  })
}

function Start-NetshTraceIfPossible {
  param([string]$TracePath)

  $result = [ordered]@{
    attempted = $true
    started = $false
    command = ('netsh trace start capture=yes report=no persistent=no tracefile="{0}" maxsize=512' -f $TracePath)
    output = $null
    error = $null
  }

  try {
    $output = & netsh trace start capture=yes report=no persistent=no tracefile="$TracePath" maxsize=512 2>&1 | Out-String
    $result.output = $output.Trim()
    if ($LASTEXITCODE -eq 0) {
      $result.started = $true
    }
  } catch {
    $result.error = $_.Exception.Message
  }

  return $result
}

function Stop-NetshTraceIfPossible {
  $result = [ordered]@{
    attempted = $true
    stopped = $false
    output = $null
    error = $null
  }

  try {
    $output = & netsh trace stop 2>&1 | Out-String
    $result.output = $output.Trim()
    if ($LASTEXITCODE -eq 0) {
      $result.stopped = $true
    }
  } catch {
    $result.error = $_.Exception.Message
  }

  return $result
}

if (-not (Test-Path -LiteralPath $WindsurfExe)) {
  throw "Windsurf executable not found: $WindsurfExe"
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$runDir = Join-Path $CaptureRoot $timestamp
$profileDir = Join-Path $runDir 'profile'
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
if ($UseIsolatedProfile) {
  New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
}

$metaPath = Join-Path $runDir 'launch-meta.json'
$processJsonl = Join-Path $runDir 'process-snapshots.jsonl'
$tcpJsonl = Join-Path $runDir 'tcp-snapshots.jsonl'
$netlogPath = Join-Path $runDir 'chromium-netlog.json'
$tracePath = Join-Path $runDir 'chromium-trace.json'
$netshTracePath = Join-Path $runDir 'network.etl'

$traceCategories = @(
  'toplevel',
  'navigation',
  'loading',
  'mojom',
  'ipc',
  'netlog',
  'disabled-by-default-network',
  'disabled-by-default-netlog'
) -join ','

$windsurfArgs = @(
  '--new-window',
  ('--log-net-log={0}' -f $netlogPath),
  '--net-log-capture-mode=Everything',
  ('--trace-startup={0}' -f $traceCategories),
  ('--trace-startup-file={0}' -f $tracePath),
  ('--trace-startup-duration={0}' -f [Math]::Max($DurationSeconds, 30)),
  '--enable-logging'
)

if ($UseIsolatedProfile) {
  $windsurfArgs += '--user-data-dir=' + $profileDir
}

$netshResult = if ($SkipNetsh) {
  [ordered]@{
    attempted = $false
    started = $false
    skipped = $true
    reason = 'skip_requested'
    output = $null
    error = $null
  }
} else {
  Start-NetshTraceIfPossible -TracePath $netshTracePath
}

$windsurf = $null
if (-not $AttachOnly) {
  $windsurf = Start-Process -FilePath $WindsurfExe -ArgumentList $windsurfArgs -PassThru
}

$meta = [ordered]@{
  startedAt = (Get-Date).ToString('o')
  runDir = $runDir
  executable = $WindsurfExe
  attachOnly = [bool]$AttachOnly
  windsurfPid = if ($windsurf) { $windsurf.Id } else { $null }
  durationSeconds = $DurationSeconds
  sampleIntervalMs = $SampleIntervalMs
  useIsolatedProfile = [bool]$UseIsolatedProfile
  artifacts = [ordered]@{
    processSnapshots = $processJsonl
    tcpSnapshots = $tcpJsonl
    chromiumNetlog = if ($AttachOnly -and $ExistingNetlogPath) { $ExistingNetlogPath } else { $netlogPath }
    chromiumTrace = if ($AttachOnly -and $ExistingTracePath) { $ExistingTracePath } else { $tracePath }
    netshTrace = $netshTracePath
  }
  netsh = $netshResult
  args = $windsurfArgs
}
$meta | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $metaPath -Encoding utf8

$deadline = (Get-Date).AddSeconds($DurationSeconds)
while ((Get-Date) -lt $deadline) {
  $now = (Get-Date).ToString('o')
  Write-JsonLine -Path $processJsonl -Value ([ordered]@{
    timestamp = $now
    kind = 'process-snapshot'
    processes = Get-WindsurfProcessSnapshot
  })
  Write-JsonLine -Path $tcpJsonl -Value ([ordered]@{
    timestamp = $now
    kind = 'tcp-snapshot'
    rows = Get-TcpSnapshot
  })
  Start-Sleep -Milliseconds $SampleIntervalMs
}

$netshStop = if ($netshResult.started) {
  Stop-NetshTraceIfPossible
} else {
  [ordered]@{
    attempted = $false
    stopped = $false
    skipped = $true
    reason = if ($SkipNetsh) { 'skip_requested' } else { 'not_started' }
    output = $null
    error = $null
  }
}

$finalMeta = Get-Content -LiteralPath $metaPath -Raw | ConvertFrom-Json
$finalMeta | Add-Member -NotePropertyName stoppedAt -NotePropertyValue ((Get-Date).ToString('o')) -Force
$finalMeta | Add-Member -NotePropertyName netshStop -NotePropertyValue $netshStop -Force
$finalMeta | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $metaPath -Encoding utf8

$finalMeta | ConvertTo-Json -Depth 8
