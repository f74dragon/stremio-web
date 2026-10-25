param([string]$ApplicationDirectory = '')
$ErrorActionPreference = 'Stop'
$productName = 'Custom Stremio'
function Get-InstallEntries([string]$RegistryRoot) {
    @(Get-ItemProperty "$RegistryRoot\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -eq $productName } |
        Select-Object DisplayName,DisplayVersion,InstallLocation,UninstallString,PSChildName)
}
$shortcutPaths = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) "$productName.lnk"),
    (Join-Path ([Environment]::GetFolderPath('Programs')) "$productName.lnk")
)
$shortcutReader = New-Object -ComObject WScript.Shell
$shortcuts = @($shortcutPaths | ForEach-Object {
    if (Test-Path -LiteralPath $_) {
        $shortcut = $shortcutReader.CreateShortcut($_)
        [pscustomobject]@{ Path = $_; TargetPath = $shortcut.TargetPath; IconLocation = $shortcut.IconLocation }
    }
})
$metadata = $null
if ($ApplicationDirectory) {
    $executable = Join-Path $ApplicationDirectory 'custom-stremio.exe'
    if (Test-Path -LiteralPath $executable) {
        $version = (Get-Item -LiteralPath $executable).VersionInfo
        $metadata = [pscustomobject]@{
            ProductName = $version.ProductName; FileDescription = $version.FileDescription
            ProductVersion = $version.ProductVersion; CompanyName = $version.CompanyName
        }
    }
}
[pscustomobject]@{
    UserEntries = @(Get-InstallEntries 'HKCU:'); MachineEntries = @(Get-InstallEntries 'HKLM:')
    Shortcuts = $shortcuts; Metadata = $metadata
} | ConvertTo-Json -Depth 5 -Compress
