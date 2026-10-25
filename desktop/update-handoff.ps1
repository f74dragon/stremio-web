param([Parameter(Mandatory=$true)][string]$Job, [int]$LauncherPid = 0)
$ErrorActionPreference = 'Stop'
$jobData = [IO.File]::ReadAllText($Job) | ConvertFrom-Json
$appBackupComplete = $false
$installationStarted = $false
$registration = @()
$updateMutex = $null
$mutexOwned = $false
function Write-Result([string]$Phase, [string]$Code) {
    $value = @{ phase = $Phase; code = $Code; version = $jobData.version }
    $temporary = "$($jobData.result).tmp"
    [IO.File]::WriteAllText($temporary, ($value | ConvertTo-Json -Compress))
    Move-Item -LiteralPath $temporary -Destination $jobData.result -Force
}
function Get-Digest([string]$Filename) {
    $stream = [IO.File]::OpenRead($Filename)
    $hash = [Security.Cryptography.SHA256]::Create()
    try { ([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $hash.Dispose(); $stream.Dispose() }
}
function Copy-Tree([string]$Source, [string]$Destination) {
    $item = Get-Item -LiteralPath $Source -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'REPARSE_POINT' }
    if ($item.PSIsContainer) {
        [IO.Directory]::CreateDirectory($Destination) | Out-Null
        foreach ($child in Get-ChildItem -LiteralPath $Source -Force) {
            Copy-Tree $child.FullName (Join-Path $Destination $child.Name)
        }
    } else { [IO.File]::Copy($Source, $Destination, $true) }
}
function Start-App {
    $options = @{ FilePath = $jobData.executable; WorkingDirectory = $jobData.installation; WindowStyle = 'Hidden' }
    if ($jobData.restartArgs.Count) { $options.ArgumentList = @($jobData.restartArgs) }
    Start-Process @options | Out-Null
}
try {
    if ($jobData.schemaVersion -ne 1 -or $jobData.parentPid -le 0) { throw 'INVALID_JOB' }
    $identityHash = [Security.Cryptography.SHA256]::Create()
    try { $identity = ([BitConverter]::ToString($identityHash.ComputeHash([Text.Encoding]::UTF8.GetBytes($jobData.installation.ToLowerInvariant())))).Replace('-', '') }
    finally { $identityHash.Dispose() }
    $updateMutex = New-Object Threading.Mutex($false, "Local\CustomStremioUpdate-$identity")
    try { $mutexOwned = $updateMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $mutexOwned = $true }
    if (-not $mutexOwned) { Write-Result 'error' 'UPDATE_IN_PROGRESS'; exit 1 }
    [IO.File]::WriteAllText($jobData.ready, (@{ helperPid = $PID; launcherPid = $LauncherPid } | ConvertTo-Json -Compress))
    $parent = Get-Process -Id $jobData.parentPid -ErrorAction SilentlyContinue
    if ($parent -and -not $parent.WaitForExit(60000)) { throw 'APP_STILL_RUNNING' }
    # Only data/profile snapshots are copied; downloaded media is never moved/deleted.
    Write-Result 'backing-up' ''
    Copy-Tree $jobData.installation $jobData.backup
    $appBackupComplete = $true
    $registration = @(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -eq 'Custom Stremio' -and $_.InstallLocation -eq $jobData.installation })
    [IO.Directory]::CreateDirectory($jobData.dataBackup) | Out-Null
    foreach ($file in Get-ChildItem -LiteralPath $jobData.dataDirectory -File -Force) {
        if ($file.Extension -in @('.json', '.ndjson')) { Copy-Tree $file.FullName (Join-Path $jobData.dataBackup $file.Name) }
    }
    $profile = Join-Path $jobData.dataDirectory 'desktop-profile'
    if (Test-Path -LiteralPath $profile) { Copy-Tree $profile (Join-Path $jobData.dataBackup 'desktop-profile') }
    if ((Get-Digest $jobData.installer) -ne $jobData.sha256) { throw 'ARTIFACT_MISMATCH' }
    Write-Result 'installing' ''
    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = $jobData.installer
    $startInfo.Arguments = "/S /D=$($jobData.installation)"
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $setup = [Diagnostics.Process]::Start($startInfo)
    $installationStarted = $true
    if (-not $setup.WaitForExit(300000)) {
        # Never kill an installer midway or launch over an uncertain installation.
        Write-Result 'error' 'INSTALLER_STILL_RUNNING'
        exit 1
    }
    if ($setup.ExitCode -eq 1618) { throw 'APP_STILL_RUNNING' }
    if ($setup.ExitCode -ne 0) { throw 'INSTALLER_FAILED' }
    if ((Get-Digest $jobData.executable) -ne $jobData.installed.exeSha256 -or
        (Get-Digest (Join-Path $jobData.installation 'resources\app.asar')) -ne $jobData.installed.asarSha256 -or
        (Get-Digest (Join-Path $jobData.installation 'resources\app.asar.unpacked\desktop\update-launcher.exe')) -ne $jobData.installed.launcherSha256) { throw 'INSTALLED_FILES_MISMATCH' }
    Write-Result 'complete' ''
    Start-App
} catch {
    $code = if ($_.Exception.Message -in @('APP_STILL_RUNNING','ARTIFACT_MISMATCH','INSTALLER_FAILED','INSTALLED_FILES_MISMATCH','REPARSE_POINT')) { $_.Exception.Message } else { 'UPDATE_FAILED' }
    if ($installationStarted -and $appBackupComplete -and $code -ne 'APP_STILL_RUNNING') {
        try {
            Copy-Tree $jobData.backup $jobData.installation
            foreach ($entry in $registration) {
                foreach ($property in @('DisplayVersion','DisplayName','DisplayIcon','InstallLocation','UninstallString','QuietUninstallString','EstimatedSize')) {
                    if ($null -ne $entry.$property) { Set-ItemProperty -LiteralPath $entry.PSPath -Name $property -Value $entry.$property }
                }
            }
            Write-Result 'rolled-back' $code
            Start-App
        } catch { Write-Result 'error' 'RESTORE_FAILED' }
    } else {
        Write-Result 'error' $code
        if ($code -ne 'APP_STILL_RUNNING') { Start-App }
    }
    exit 1
} finally {
    if ($mutexOwned) { $updateMutex.ReleaseMutex() }
    if ($updateMutex) { $updateMutex.Dispose() }
}
