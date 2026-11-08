<#
ficsmap save watcher: uploads every new Satisfactory save in a folder to a ficsmap world.

@@GENERATED@@
KEEP THIS FILE PRIVATE: it contains the upload token of your world. Anyone with it can upload saves there.
Revoke the token in the world's settings ("Automatic upload") if the file gets out.

Runs on Windows PowerShell 5.1 and PowerShell 7. Watches the folder (FileSystemWatcher) and also checks it every
PollSeconds. It sends nothing but the save file, its name and the token to ServerUrl.

Usage: powershell -ExecutionPolicy Bypass -File ficsmap-watch.ps1          watch until stopped (Ctrl+C)
       powershell -ExecutionPolicy Bypass -File ficsmap-watch.ps1 -Once    upload what is new and exit
Log and the list of uploaded saves: %LOCALAPPDATA%\ficsmap
#>
[CmdletBinding()]
param([switch]$Once)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

# --- Settings (written by ficsmap; FICSMAP_SAVE_DIR, FICSMAP_STATE_DIR, FICSMAP_POLL_SECONDS override them) ---
$ServerUrl = @@SERVER_URL@@
$WorldId = @@WORLD_ID@@
$UploadToken = @@TOKEN@@
$SaveDir = @@SAVE_DIR@@
# Only saves whose file name starts with "<SessionFilter>_" (empty: every save; the server still checks the session).
$SessionFilter = @@SESSION@@
$PollSeconds = @@POLL_SECONDS@@
# newest: upload only the newest new save; all: upload every new save, oldest first.
$UploadMode = @@MODE@@
# Where the log and the list of uploaded saves are kept (empty: %LOCALAPPDATA%\ficsmap).
$StateDir = @@STATE_DIR@@
# A save counts as written once its size and time have not changed for this long.
$StableSeconds = 5
# --- End of settings ---

if ($env:FICSMAP_SAVE_DIR) { $SaveDir = $env:FICSMAP_SAVE_DIR }
if ($env:FICSMAP_STATE_DIR) { $StateDir = $env:FICSMAP_STATE_DIR }
if ($env:FICSMAP_POLL_SECONDS) { $PollSeconds = [int]$env:FICSMAP_POLL_SECONDS }

$SaveDir = [Environment]::ExpandEnvironmentVariables($SaveDir)
if ($SaveDir -eq '~' -or $SaveDir.StartsWith('~/') -or $SaveDir.StartsWith('~\')) {
    $SaveDir = Join-Path $HOME $SaveDir.Substring(1).TrimStart('/', '\')
}
if (-not $StateDir) {
    $base = $env:LOCALAPPDATA
    if (-not $base) { $base = Join-Path $HOME '.local/state' }
    $StateDir = Join-Path $base 'ficsmap'
}
$StateDir = [Environment]::ExpandEnvironmentVariables($StateDir)

function Stop-WithError([string]$Message) {
    Write-Host "ERROR: $Message" -ForegroundColor Red
    exit 1
}

if ($ServerUrl -notmatch '^https?://[^\s/]+(/\S*)?$') { Stop-WithError "ServerUrl is not an http(s) URL: $ServerUrl" }
if ($WorldId -notmatch '^[0-9a-fA-F-]{36}$') { Stop-WithError "WorldId is not a world id: $WorldId" }
if ($UploadToken -cnotmatch '^fsm_[0-9]+_[A-Za-z0-9_-]{43}$') { Stop-WithError 'UploadToken is not a ficsmap upload token' }
if ($PollSeconds -lt 5) { Stop-WithError 'PollSeconds must be at least 5' }
if ($UploadMode -ne 'newest' -and $UploadMode -ne 'all') { Stop-WithError 'UploadMode must be newest or all' }

if ($PSVersionTable.PSVersion.Major -lt 6) {
    # Windows PowerShell 5.1 may still default to TLS 1.0.
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
}

$UploadUrl = $ServerUrl.TrimEnd('/') + "/api/worlds/$WorldId/saves"
$null = New-Item -ItemType Directory -Force -Path $StateDir
$StateFile = Join-Path $StateDir "uploaded-$WorldId.txt"
$LogFile = Join-Path $StateDir "watch-$WorldId.log"
$FirstRun = -not (Test-Path -LiteralPath $StateFile)
$Utf8 = New-Object System.Text.UTF8Encoding($false)

$Done = New-Object 'System.Collections.Generic.HashSet[string]'
if (-not $FirstRun) {
    foreach ($line in [IO.File]::ReadAllLines($StateFile)) { if ($line) { $null = $Done.Add($line.Trim()) } }
} else {
    [IO.File]::WriteAllText($StateFile, '', $Utf8)
}
$HashOf = @{}    # "path|size|time" -> sha256, so unchanged files are hashed once
$RetryAt = @{}   # sha256 -> time before which a failed save is not tried again

function Write-Log([string]$Message) {
    $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Write-Host $line
    try { [IO.File]::AppendAllText($LogFile, $line + [Environment]::NewLine, $Utf8) } catch { }
}

function Get-Saves {
    if (-not (Test-Path -LiteralPath $SaveDir -PathType Container)) { return @() }
    $prefix = $SessionFilter + '_'
    # A dedicated server keeps its settings in ServerSettings.<port>.sav next to the saves.
    $all = @(Get-ChildItem -LiteralPath $SaveDir -Filter '*.sav' -File -Recurse -Depth 1 -ErrorAction SilentlyContinue)
    $all = @($all | Where-Object { $_.Extension -eq '.sav' -and -not $_.Name.StartsWith('ServerSettings.') -and (-not $SessionFilter -or $_.Name.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) })
    return @($all | Sort-Object LastWriteTimeUtc)
}

# True once a file's size and time stop changing (a file untouched for longer than StableSeconds counts as written).
function Wait-Stable([IO.FileInfo]$File) {
    $File.Refresh()
    if (-not $File.Exists) { return $false }
    if ($File.Length -gt 0 -and ((Get-Date).ToUniversalTime() - $File.LastWriteTimeUtc).TotalSeconds -gt $StableSeconds) { return $true }
    $before = '{0}:{1}' -f $File.Length, $File.LastWriteTimeUtc.Ticks
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds $StableSeconds
        $File.Refresh()
        if (-not $File.Exists) { return $false }
        $after = '{0}:{1}' -f $File.Length, $File.LastWriteTimeUtc.Ticks
        if ($after -eq $before -and $File.Length -gt 0) { return $true }
        $before = $after
    }
    return $false
}

function Get-SaveHash([IO.FileInfo]$File) {
    $key = '{0}|{1}|{2}' -f $File.FullName, $File.Length, $File.LastWriteTimeUtc.Ticks
    if ($HashOf.ContainsKey($key)) { return $HashOf[$key] }
    if (-not (Wait-Stable $File)) { return $null }
    $key = '{0}|{1}|{2}' -f $File.FullName, $File.Length, $File.LastWriteTimeUtc.Ticks
    try { $hash = (Get-FileHash -LiteralPath $File.FullName -Algorithm SHA256).Hash.ToLowerInvariant() } catch { return $null }
    $HashOf[$key] = $hash
    return $hash
}

function Set-Done([string]$Hash) {
    $null = $Done.Add($Hash)
    [IO.File]::AppendAllText($StateFile, $Hash + "`n", $Utf8)
}

# One upload: @{ Code = HTTP status (0: no answer); Body = the answer's text }.
function Send-Save([IO.FileInfo]$File) {
    $params = @{
        Uri                = $UploadUrl
        Method             = 'Post'
        InFile             = $File.FullName
        ContentType        = 'application/octet-stream'
        Headers            = @{ 'Authorization' = "Bearer $UploadToken"; 'X-Save-Name' = [Uri]::EscapeDataString($File.Name) }
        UseBasicParsing    = $true
        TimeoutSec         = 900
        MaximumRedirection = 0
    }
    try {
        if ($PSVersionTable.PSVersion.Major -ge 7) {
            $r = Invoke-WebRequest @params -SkipHttpErrorCheck
        } else {
            $r = Invoke-WebRequest @params
        }
        return @{ Code = [int]$r.StatusCode; Body = [string]$r.Content }
    } catch [System.Net.WebException] {
        $resp = $_.Exception.Response
        if ($null -eq $resp) { return @{ Code = 0; Body = $_.Exception.Message } }
        $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
        try { $body = $reader.ReadToEnd() } finally { $reader.Dispose() }
        return @{ Code = [int]$resp.StatusCode; Body = $body }
    } catch {
        return @{ Code = 0; Body = $_.Exception.Message }
    }
}

function Get-Field($Json, [string]$Name) {
    if ($null -ne $Json -and $Json.PSObject.Properties[$Name]) { return $Json.$Name }
    return ''
}

# 0 done (stored or refused for good), 1 try again later, 2 the token was refused.
function Invoke-UploadOnce([IO.FileInfo]$File) {
    $res = Send-Save $File
    $json = $null
    try { $json = $res.Body | ConvertFrom-Json } catch { }
    $name = $File.Name
    switch ($res.Code) {
        { $_ -eq 200 -or $_ -eq 201 } {
            switch (Get-Field $json 'status') {
                'imported' { Write-Log ("Imported {0}: {1} newly checked, factory snapshot {2}." -f $name, (Get-Field $json 'newlyChecked'), (Get-Field $json 'snapshot')) }
                'snapshot' { Write-Log "Added $name to the timeline (older than the last import)." }
                'duplicate' { Write-Log "$name is already in the world." }
                default { Write-Log "Uploaded $name (HTTP $($res.Code))." }
            }
            return 0
        }
        { $_ -in 400, 409, 413, 415 } {
            Write-Log ("Server refused {0} (HTTP {1}): {2} It is not tried again." -f $name, $res.Code, (Get-Field $json 'message'))
            return 0
        }
        { $_ -in 401, 403, 404 } {
            Write-Log "ERROR: the server refused the upload token (HTTP $($res.Code)). It may have been revoked: create a new one in the world's settings and download the script again."
            return 2
        }
        0 {
            Write-Log "Could not reach ${ServerUrl}: $($res.Body) Will try again."
            return 1
        }
        default {
            Write-Log ("Upload of {0} failed (HTTP {1}): {2} Will try again." -f $name, $res.Code, (Get-Field $json 'message'))
            return 1
        }
    }
}

# Uploads with retries (10 s, 30 s, 90 s); after that the save waits 10 minutes (an hour when the token was refused).
function Invoke-Upload([IO.FileInfo]$File, [string]$Hash) {
    Write-Log "Uploading $($File.Name) ..."
    for ($attempt = 1; $attempt -le 4; $attempt++) {
        $rc = Invoke-UploadOnce $File
        if ($rc -eq 0) { Set-Done $Hash; $RetryAt.Remove($Hash); return }
        if ($rc -eq 2) { $RetryAt[$Hash] = (Get-Date).AddHours(1); return }
        if ($attempt -lt 4) { Start-Sleep -Seconds (10 * [Math]::Pow(3, $attempt - 1)) }
    }
    $RetryAt[$Hash] = (Get-Date).AddMinutes(10)
}

function Invoke-Scan {
    if (-not (Test-Path -LiteralPath $SaveDir -PathType Container)) {
        Write-Log "Waiting for the save folder $SaveDir to appear ..."
        return
    }
    $saves = @(Get-Saves)
    if ($saves.Count -eq 0) { $script:FirstRun = $false; return }
    if ($script:FirstRun) {
        # First start: older saves already there are left alone (add them with "Add older saves" in the browser).
        for ($i = 0; $i -lt $saves.Count - 1; $i++) {
            $h = Get-SaveHash $saves[$i]
            if ($h -and -not $Done.Contains($h)) { Set-Done $h }
        }
        if ($saves.Count -gt 1) { Write-Log "First start: $($saves.Count) saves found; only the newest is uploaded." }
        $script:FirstRun = $false
    }
    if ($UploadMode -eq 'newest') { $saves = @($saves[-1]) }
    foreach ($file in $saves) {
        $h = Get-SaveHash $file
        if (-not $h -or $Done.Contains($h)) { continue }
        if ($RetryAt.ContainsKey($h) -and (Get-Date) -lt $RetryAt[$h]) { continue }
        Invoke-Upload $file $h
    }
}

$filterText = if ($SessionFilter) { $SessionFilter } else { 'any session' }
Write-Log "ficsmap save watcher: $SaveDir -> $ServerUrl (world $WorldId, $filterText, $UploadMode, watching and checking every ${PollSeconds}s)"

Invoke-Scan
if ($Once) { exit 0 }

$watcher = $null
try {
    while ($true) {
        if ($null -eq $watcher -and (Test-Path -LiteralPath $SaveDir -PathType Container)) {
            try {
                $watcher = New-Object System.IO.FileSystemWatcher($SaveDir, '*.sav')
                $watcher.IncludeSubdirectories = $true
                $watcher.NotifyFilter = [IO.NotifyFilters]'FileName, LastWrite, Size'
            } catch {
                $watcher = $null   # e.g. some network drives: keep checking every PollSeconds
            }
        }
        if ($null -ne $watcher) {
            $null = $watcher.WaitForChanged([IO.WatcherChangeTypes]::All, $PollSeconds * 1000)
        } else {
            Start-Sleep -Seconds $PollSeconds
        }
        Invoke-Scan
    }
} finally {
    if ($null -ne $watcher) { $watcher.Dispose() }
    Write-Log 'Stopped.'
}
