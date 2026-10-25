# Windows release contract

## Scope and current state

Phases 1–3 establish the release foundation, Windows x64 launcher, and per-user installer.
Phase 4 adds personal local updates. The user explicitly clarified that the app
is only for their own use: public distribution, release publishing, commercial
publisher certificates, and public/private GitHub binary feeds are outside scope.
The launcher runs the packaged frontend/Core and owns a private authenticated
backend with exclusive data-root access, graceful IPC shutdown, recovery, and a
persistent desktop profile. See [build/run instructions](../desktop/README.md).
The local alpha includes PE branding and install/reinstall/uninstall retention
checks with isolated profiles. Personal updates use locally selected Ed25519-signed
metadata and SHA-256-verified installers, with explicit safe restart and retained
app/data backups. Unattended updates remain disabled. Official Stremio binaries
are never accepted as this fork's app updates.

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
| Personal update source | Locally built signed bundle; no release feed |

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

Personal update delivery is a local signed bundle, without polling or credentials.
The separate update window checks/prepares a selected JSON + adjacent setup,
shows progress, permits cancellation, and waits for explicit restart confirmation.
The main app keeps playing until that decision. Main-renderer and update-window
IPC capabilities are separated. Only the main process reads native file selections;
renderer requests cannot supply a path, command, URL, or installer argument.

The checked-in Ed25519 public key authenticates locally built update metadata;
the private key stays outside the checkout under Local AppData on this PC. The signature covers app/channel/Windows
architecture, version, data schema contract, source commit, installer size/hash,
and installed executable/ASAR hashes. Downgrades and data-schema changes fail closed.
The clean-source `desktop:update` command signs a newly built installer without
publishing. Keep the private key backed up privately; loss requires deliberately
establishing a new identity through a manual reinstall. Windows Authenticode
signing is separate and is not required for this personal-use scope.

Restart first drains the owned backend. A forced/failed shutdown cancels the
update. A compiled windowless bridge launches built-in Windows PowerShell outside
the parent-owned process job and verifies readiness before the app quits. The helper waits for the app/profile
to close, takes app/profile/store backups, rehashes setup, runs the per-user NSIS
installer, verifies the resulting files, and relaunches. It never kills an app
or an uncertain installer, and serializes helpers with a per-installation mutex.
Setup/verification failure restores previous app files/registration before
relaunch. Backups are local and contain personal data; no CI artifact includes
them. The app does not automatically downgrade after a new build has started
writing user data. No store schema migration is part of this phase.

Stremio's normal streaming service defaults to `127.0.0.1:11470`; our download
backend defaults to `127.0.0.1:5577` and does not replace it. The launcher must
detect/explain the optional streaming-service dependency for playback modes that
need it. MPC-HC remains an explicitly selected external installation. No claim
of a fully self-contained torrent engine or bundled MPC-HC is made.

## Remaining acceptance gates

- Phase 3 local checks: the actual per-user installer and installed executable
  have passed shortcut/registration, numeric PE version and prerelease display
  version, custom icon, no Node/npm on PATH, running-app protection, graceful
  Quit, reinstall, uninstall data/media retention, and reinstall after uninstall.
  `desktop/installer.nsh` uses supported NSIS customization hooks to refuse
  replacement/removal until the user quits; it does not force-kill the app.
  Setup/checksum/blockmap/component manifest are generated locally without
  publishing or enabling updates. The alpha is unsigned. Tests use an isolated
  profile on the existing Windows machine, not a freshly provisioned VM.

- Phase 2: real packaged-origin worker/WASM/addon/login/media behavior, backend
  ownership/port conflict handling, data-root lock, offline startup, graceful
  quit, tray behavior, and crash recovery.
- Optional extra confidence: repeat setup/playback on a clean Windows VM. This
  is not a distribution requirement for the user's personal-machine scope.
- Ongoing maintenance: review upstream trust/URL fixes and custom Core migration;
  keep the packaged boundary and secret-free allowlist tested. Public release,
  publisher signing, and release-feed access are outside the requested scope.
- Phase 4 local acceptance: actual installed A -> failed B/restore -> verified B
  passes with profile sentinel, settings, queue/partial transfer and Range resume,
  records/history, opaque personal state, media, and playback-position retention.
  Actual account login/sync remains the live Phase 5 check, not a synthetic-test claim.
- Phase 5: account/addon/browser playback plus live movie/episode MPC-HC sync and
  download interruption/resume in the installed application.
