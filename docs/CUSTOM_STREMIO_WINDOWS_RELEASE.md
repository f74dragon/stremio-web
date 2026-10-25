# Windows release contract

## Scope and current state

The user approved Phase 1 on October 25, 2026. This phase establishes a recoverable
source baseline, source-maintenance decisions, application identity, persistent
paths, and a tested backend health contract. Electron launcher implementation is
Phase 2; installer, update delivery, and installed-app acceptance follow. The
configuration below is preparatory, not a claim that those later features exist.

The target is an Electron host for the production frontend and a bundled Node
backend process, followed by a Windows x64 per-user NSIS installer. Electron
provides a Node-capable [utility process](https://www.electronjs.org/docs/latest/api/utility-process).
NSIS supports [electron-updater](https://www.electron.build/v26/docs/features/auto-update/).
Pin supported stable dependencies when implementing those phases; do not adopt
unreleased electron-builder features from its default next-version documentation.

## Source checkpoint and reproducibility

- Before Phase 1 edits, all tracked/non-ignored untracked source was captured in
  commit `bf0863a1b9f207f064b9372d63b1bffae50f7fec`, retained by private local ref
  `refs/checkpoints/windows-phase1-2026-10-25`. The branch and real Git index did
  not change; the checkpoint used an isolated index. Nothing was pushed.
- Parent/source HEAD: `ed8cd5147b456d761c3b6ca8a44870c97f1ab9fb`.
- Additional source archive: ignored
  `.core-build/release-foundation/pre-phase1-source.zip`; SHA-256
  `9953977109c3174b1f280f0ad9c03fa3710c59c767c088b6ab693beb3243db7f`.
  `checkpoint.json` alongside it records the checkpoint and archive identity.
- Inspect with `git show refs/checkpoints/windows-phase1-2026-10-25` or
  `git diff HEAD refs/checkpoints/windows-phase1-2026-10-25`. Restore selected
  files deliberately from the archive/ref; never reset the entire current worktree
  as a routine packaging step.
- `pnpm verify:release` validates metadata/compatibility wiring and prints the
  current Core archive SHA-256 and source dirty status. The `--require-clean`
  option is the future release gate: package only a committed, clean tree with a
  frozen lockfile. The preflight is not a substitute for tests or a production build.
- Retain the checked-in custom Core archive and lockfile integrity. Normal
  frontend builds use that archive without Rust/Docker. Rebuilding Core still
  requires its pinned recipe and tests under `core-patches/` and `scripts/`.
- Build-tool baseline: `.nvmrc` pins the tested Node `24.19.0`; the root
  `packageManager` pins pnpm `10.33.2`. Updating either is a tested source change,
  independent of the eventual Electron-bundled Node runtime.

## Identity and versioning

| Field | Contract |
| --- | --- |
| Product | `Custom Stremio` |
| Desktop package | `custom-stremio-desktop` |
| Application ID / future Windows AUMID | `io.github.f74dragon.customstremio` |
| Executable | `custom-stremio` |
| Initial desktop version/channel | `0.1.0-alpha.1` / `alpha` |
| Stable packaged renderer origin | `custom-stremio://app` |
| Proposed binary release source | `f74dragon/stremio-web` GitHub Releases |

`desktop/package.json` owns the desktop version; `desktop/release-config.json`
owns the other settings. Keep identity and origin stable across upgrades. The
root package version remains upstream provenance (`5.0.0-beta.37` currently);
the backend has its own package version (`0.1.0`) and protocol version (`1`).
Do not copy upstream release numbers into the desktop version. Alpha releases
stay in an explicit prerelease channel; switching to stable is a deliberate
release decision. Official Stremio binaries must never be this fork's update feed.

The custom origin must be registered as a standard, secure Electron scheme in
Phase 2, with safe asset-path resolution and tested worker/WASM/media access.
Do not expose the web frontend as a generic filesystem browser. Keep browser
development behavior available separately. Chromium's persistent origin/profile
must not vary with a random backend port or app version.

## Persistent data and upgrade policy

`local-backend/dataDirectory.js` retains the exact existing resolution order:
`CUSTOM_STREMIO_DATA_DIR`, then `%LOCALAPPDATA%\Custom Stremio`, then
`~/.custom-stremio` when Local AppData is unavailable. Existing store imports
continue to work through `downloadRecordStore.js`.

`desktop/data-paths.cjs` derives these paths without reading/creating files:

| Data | Relative to the existing backend data root |
| --- | --- |
| Records, history, backend settings, progress, provider state | Existing files at root |
| Electron `userData` | `desktop-profile` |
| Electron `sessionData` | `desktop-profile/session` |
| Desktop logs | `logs/desktop` |
| Backup of data before schema upgrades | `release-backups` |

In Phase 2 set Electron's paths before readiness, using its
[path API](https://www.electronjs.org/docs/latest/api/app#appsetpathname-path).
All desktop paths follow an explicit existing custom data-root override. Do not
write mutable files to the installation folder or put versions in profile paths.
Downloaded media remains at its current selected paths. Browser Chrome/Edge
profiles are separate: initial desktop login is expected; copying browser tokens
or silently importing an entire browser profile is outside this contract.

Initial packaging does not migrate store schemas: records v1, settings v6,
history v1, and playback progress v1 retain their existing formats. Before a later
schema change, acquire exclusive access, flush stores, back up data, migrate
atomically, and test both upgrade and failed-upgrade recovery. Never overwrite
newer/unsupported data on downgrade. Reinstall/ordinary uninstall should retain
user data and media; destructive data removal needs a separate explicit choice.
Keep provider secrets out of logs, release artifacts, and updater configuration.
Desktop credential-at-rest handling remains a later implementation review.

## Backend readiness, compatibility, and ownership

`GET /health` keeps `ok`, `time`, and `downloads` while now reporting actual
package `version`, `service`, numeric `protocolVersion`, and capabilities:
`download-records-v1`, `download-history-v1`, `mpc-hc-progress-v1`.

The shared browser-safe contract is `src/customStremio/localBackendProtocol.js`.
`desktop/backend-compatibility.cjs` requires the exact bundled backend package
version, current protocol, all required capabilities, correct service name, and
`ok: true`. Additive fields/capabilities are allowed. Old `version: dev` health
responses without a protocol fail closed. This does not change ordinary web
client polling or require the currently running development backend to restart.

Phase 2 must enforce ownership independently of this compatibility check:

1. Acquire an exclusive lock for the backend data root before loading/recovering
   stores. Single-instance Electron windows alone do not prevent a standalone
   development backend from writing the same files.
2. Establish the child process/instance identity through a private control channel.
   A health JSON response is not proof that a process is safe to stop or reuse.
3. Bind only to loopback; pass the desktop backend address through a narrow,
   validated preload bridge. The browser development default remains port 5577.
4. Detect legacy, incompatible, or unrelated port owners. Never kill by port,
   attach solely on matching health, or start a second writer against the same
   data root. Show an actionable conflict/retry state. Alternative ports are safe
   only with data-root exclusivity established.
5. Expose readiness after local recovery. Defer network cleanup/retries so an
   unavailable provider cannot indefinitely block launching offline.
6. On Quit/update use explicit graceful IPC to stop/pause work, save records and
   progress, and flush history. Bound the wait; forced termination is limited to
   the owned child and must preserve the recovery path. Windows signal delivery
   must not be the only shutdown mechanism. Closing to tray can retain downloads;
   explicit Quit must be clear and testable.

Keep Node integration disabled in renderers, with context isolation, sandboxing,
validated IPC, restricted navigation/external protocols, and an appropriate CSP.
Restrict privileged loopback API access to intended clients; current permissive
CORS/development-origin rules need a packaged-mode boundary. Follow Electron's
[security guidance](https://www.electronjs.org/docs/latest/tutorial/security),
rather than disabling web security or certificate checks for compatibility.

## Updates and playback dependencies

Upstream source maintenance is covered separately in
[the upstream audit/workflow](CUSTOM_STREMIO_UPSTREAM_UPDATES.md). A reviewed
source change becomes an installed update only after regression tests and a new
fork desktop release. Bundle the frontend, backend, Core, and runtime as one
versioned unit. Disable the web service worker/update-reload mechanism in packaged
mode in Phase 2 so it cannot mix frontend and backend release generations.

Automatic updates are disabled in Phase 1. The updater phase must implement
check/download/progress/restart UI, artifact verification, and installation only
after an explicit safe restart. Active transfers, provider cleanup, and playback
must not be interrupted by an automatic forced restart. Test an actual installed
version A -> B upgrade before enabling delivery. Confirm release-repository
visibility/access and code-signing publisher setup before publishing; do not ship
a GitHub account token in the client. Initial local unsigned installer testing
can precede public distribution/signing arrangements.

Stremio's normal streaming service defaults to `127.0.0.1:11470`; our download
backend defaults to `127.0.0.1:5577` and does not replace it. The launcher must
detect/explain the optional streaming-service dependency for playback modes that
need it. MPC-HC remains an explicitly selected external installation. No claim
of a fully self-contained torrent engine or bundled MPC-HC is made.

## Remaining acceptance gates

- Phase 2: real packaged-origin worker/WASM/addon/login/media behavior, backend
  ownership/port conflict handling, data-root lock, offline startup, graceful
  quit, tray behavior, and crash recovery.
- Phase 3: clean Windows profile with no Node/npm, install/relaunch/reinstall,
  per-user shortcuts, and uninstall retention.
- Before public release: upstream trust/URL fixes reviewed/backported or adopted
  with the larger migration; packaged API/security boundary; secret-free artifact
  allowlist (exclude dev TLS keys, `.git`, `.codex`, local state/logs, and backups);
  licenses/Core provenance included; signing/release access decided.
- Phase 4: installed A -> B update with preserved login/profile, settings, queue,
  history, provider state, media paths, and progress; safe failed-update behavior.
- Phase 5: account/addon/browser playback plus live movie/episode MPC-HC sync and
  download interruption/resume in the installed application.
