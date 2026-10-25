param([switch]$TestsOnly)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskSource = Join-Path $taskRoot '.core-build/source'
$taskRevision = 'c7ba205c881cebc2022b6614b0fd2075789169c0'
if (-not (Test-Path -LiteralPath $taskSource)) {
    git clone --depth 1 --branch stremio-core-web-v0.58.0 https://github.com/Stremio/stremio-core.git $taskSource
    if ($LASTEXITCODE -ne 0) { throw 'Core source download failed.' }
}
if ((git -C $taskSource rev-parse HEAD).Trim() -ne $taskRevision) { throw 'Unexpected Core source revision.' }
$taskPatch = Join-Path $taskRoot 'core-patches/external-playback.patch'
if (-not (Select-String -LiteralPath (Join-Path $taskSource 'src/runtime/msg/action.rs') -SimpleMatch 'ExternalPlaybackProgressChanged' -Quiet)) {
    git -C $taskSource apply --unidiff-zero --ignore-whitespace $taskPatch
    if ($LASTEXITCODE -ne 0) { throw 'Core patch failed; inspect the isolated source checkout.' }
}
Copy-Item -LiteralPath (Join-Path $taskRoot 'core-patches/update_external_playback.rs') -Destination (Join-Path $taskSource 'src/models/ctx/update_external_playback.rs')
Copy-Item -LiteralPath (Join-Path $taskRoot 'core-patches/external_playback_tests.rs') -Destination (Join-Path $taskSource 'src/unit_tests/ctx/external_playback.rs')
$taskDockerArgs = @('run', '--rm',
    '--mount', "type=bind,source=$taskRoot,target=/repo",
    '--mount', 'type=volume,source=custom-stremio-cargo-cache,target=/usr/local/cargo/registry',
    '--mount', 'type=volume,source=custom-stremio-cargo-git,target=/usr/local/cargo/git',
    '--mount', 'type=volume,source=custom-stremio-core-target,target=/repo/.core-build/source/target',
    '--workdir', '/repo/.core-build/source',
    'rust:1.95.0-bookworm@sha256:6258907abe69656e41cd992e0b705cdcfabcbbe3db374f92ed2d47121282d4a1',
    'bash', '/repo/scripts/build-custom-core.sh')
if ($TestsOnly) { $taskDockerArgs += '--tests-only' }
docker @taskDockerArgs
if ($LASTEXITCODE -ne 0) { throw 'Core build/tests failed.' }
if (-not $TestsOnly) {
    node (Join-Path $PSScriptRoot 'package-custom-core.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'Core package preparation failed.' }
    Push-Location (Join-Path $taskRoot '.core-build/package')
    try {
        npm.cmd pack --ignore-scripts --pack-destination (Join-Path $taskRoot 'vendor')
        if ($LASTEXITCODE -ne 0) { throw 'Core package archive failed.' }
    } finally { Pop-Location }
}
