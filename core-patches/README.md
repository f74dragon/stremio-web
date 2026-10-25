# Custom Core playback extension

The frontend uses `vendor/stremio-stremio-core-web-0.58.0-custom.1.tgz`, built from
Stremio Core tag `stremio-core-web-v0.58.0`, commit
`c7ba205c881cebc2022b6614b0fd2075789169c0` (MIT licensed).

`external-playback.patch` adds one Ctx action and routes it to
`update_external_playback.rs`. `external_playback_tests.rs` exercises the real Core
runtime, storage, and a mocked account datastore request. The rest of the pinned
Core stays unchanged. No background Player or MetaDetails model is loaded.

Rebuild on Windows with Docker Desktop running:

```powershell
pnpm run build:core
pnpm update @stremio/stremio-core-web --offline --ignore-scripts
node scripts/smoke-custom-core.cjs
pnpm run build
```

The recipe pins the Rust Docker image digest, source revision, Cargo lockfile and
wasm-bindgen version. It runs the Core tests before compiling the WASM package,
retains the upstream license, and includes provenance in the archive. Generated
sources and tools live in ignored `.core-build/`; Docker volumes retain compiler
and dependency caches. Ordinary frontend installs/builds use the checked-in archive
and do not require Docker or Rust. A changed archive must be accompanied by its
updated pnpm lockfile integrity.

See `docs/CUSTOM_STREMIO_EXTERNAL_PLAYBACK.md` for behavior and live verification.
