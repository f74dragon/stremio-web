# Custom Stremio for Windows

The Windows x64 app bundles the production frontend, custom Core, download
backend, and Electron 45.0.0. Node/npm and a development web server are not needed
to run it. The per-user NSIS installer includes its own executable/shortcut icon
and version metadata. This is your personal app, with local signed update bundles.
No public distribution, release feed, account token, or publisher certificate is
required. Windows setup remains unsigned; bundle signatures use your own local key.

## Install and use

Run `Custom-Stremio-0.1.0-alpha.2-windows-x64-setup.exe` from
`dist/windows-installer/`, then open **Custom Stremio** from the Start Menu or
desktop shortcut. Setup installs for the current user without requesting
administrator rights and does not auto-launch the app. Quit an already-running
copy before installing, reinstalling, or uninstalling. Closing its window keeps
the app running in the tray; use **App > Quit** or **Ctrl+Q**.

Uninstall through Windows Installed Apps. Ordinary uninstall removes the app and
shortcuts while keeping the desktop login/profile, backend settings, download
records/history/progress, and downloaded media. Reinstall uses the same data root.
The installer never copies or deletes the browser profile. Installed desktop login
remains separate from Chrome/Edge login.

## Build and run

Use Node 24.19.0 and the repository's pinned pnpm 10.33.2 from the repository root:

```powershell
pnpm install --frozen-lockfile
npm ci --prefix local-backend --ignore-scripts
pnpm desktop:installer
& .\dist\windows-installer\Custom-Stremio-0.1.0-alpha.2-windows-x64-setup.exe
```

The installer output includes a SHA-256 checksum, blockmap for future updater
work, and `release-manifest.json` with component versions, source commit/dirty
state, Core digest, and installer checksum. `build-info.json` is also included in
the app ASAR. Automatic update delivery remains disabled; no release is published
by these commands. Build from a clean commit and run
`pnpm verify:release --require-clean` before preparing release artifacts.

`pnpm desktop:build` still creates an unpacked app at
`dist/windows-launcher/win-unpacked/custom-stremio.exe`. Keep that entire folder
together. Installer builds use `dist/windows-installer/` so they can run without
overwriting an open unpacked app. All generated output is ignored by Git.

For launcher development, run `pnpm build:desktop-ui` and then `pnpm desktop`.
Browser development remains separate on port 5577. The desktop build disables the
web service worker and browser Cast sender SDK; casting is not supported here.

## Daily use and recovery

- The launcher starts its own authenticated loopback backend on an assigned port.
  Stop an older terminal backend in its terminal before opening the desktop app.
  The launcher refuses to share its data, reuse it, or terminate it.
- Close hides the window to the tray while downloads continue. Open the tray icon
  or run the app again to restore it. Choose **Quit** in the tray or App menu
  (Ctrl+Q) to pause downloads, save stores, and stop the owned service.
- Startup/backend failures offer **Try again**, **Open diagnostics**, and **Quit**.
  Launcher logs contain events/error codes, not provider credentials or media URLs.
  A bounded shutdown can terminate only the owned child; interrupted downloads
  recover paused on the next launch.
- Backend files retain their data root: `CUSTOM_STREMIO_DATA_DIR`, otherwise
  `%LOCALAPPDATA%\Custom Stremio`. The persistent desktop profile lives in
  `desktop-profile` beneath it. Browser login/profile data stays separate; sign in
  once in the desktop app. This phase introduces no store schema migration.
- Select MPC-HC in Downloads settings for local playback. **Help > Playback
  requirements** checks the optional Stremio service on port 11470. Some streaming
  formats need that separate service; browsing/direct downloads do not. Neither
  the Stremio streaming service nor MPC-HC is bundled.

## Personal app updates

Install `0.1.0-alpha.2` manually once to get the updater. Open **App > App updates**
(press Alt to reveal the menu) or **App updates** in the tray. Select a
`.stremio-update.json` file with its matching setup executable beside it.
Preparation copies/verifies the installer while the main app remains usable.
Choose **Restart and update** and confirm when you are ready to pause downloads
and close in-app playback. Ordinary Quit never installs a prepared update.

To make your next update, review/test source changes, increment only
`desktop/package.json` (for example `0.1.0-alpha.2` to `0.1.0-alpha.3`), update the
tracker, commit, then run:

```powershell
pnpm desktop:update
```

Building the windowless update bridge uses the Windows .NET Framework compiler
already present on this machine; the installed app needs no compiler or SDK.
This requires a clean source tree and creates the installer plus signed update
JSON in `dist/windows-installer/`. Select that JSON in the installed app. There is
no GitHub publishing, update server, background check, download, or automatic restart.
Upstream source updates still follow the separate reviewed integration workflow;
official Stremio binaries cannot update this custom build.

The app pins `desktop/update-public-key.pem`. Its matching private key was created
locally at `%LOCALAPPDATA%\Custom Stremio Build\update-signing-key.pem`, outside
the checkout and disposable build storage, and is excluded from all app/CI
artifacts. Keep a private backup. `CUSTOM_STREMIO_SIGNING_KEY` can select another
local key file for builds. A fresh checkout can build/install the app with only
the public key, but cannot sign updates without that private key. If the key is lost, replace the
identity deliberately and manually reinstall; the app does not trust a new signer
automatically. `desktop:update:key` only creates a new identity when neither key
exists, and refuses to overwrite an existing identity. It is not a routine build step.

Updates reject other identities/platforms/channels, same/older versions, changed
installer bytes, and changed data schema versions. Before setup, the helper waits
for the old app to exit, keeps its app files under `updates/<id>/previous-app`, and
backs up profile/root JSON/NDJSON stores under `release-backups/<id>` in your data
root. Media is not copied or moved. It verifies the resulting executable, ASAR,
and unpacked update bridge before relaunching. A failed install/verification
restores the previous app files and registration, then reopens it; user data is kept. If restore fails, manually
reinstall the previous setup using the retained backups. An installer that times
out is left running rather than killed or overlapped. These backups contain
personal profile/state; keep them private. Old backups are retained until you
choose to remove them; each includes a full copy of the previous app.

## Verification

```powershell
pnpm test -- --runInBand
pnpm lint
pnpm desktop:build
pnpm desktop:test
pnpm desktop:installer
pnpm desktop:installer:test
pnpm desktop:update:test
```

`desktop:test` loads the actual packaged ASAR with Electron in an isolated profile,
uses software rendering for deterministic capture, and checks Core/WASM, sandbox,
authenticated backend access, Downloads, persistent storage, close-to-tray,
crash/retry, and graceful Quit. Only this test adapter skips the legacy-port probe
so an existing developer backend can remain running; the release launcher retains
that probe. The probe and exclusive data-root ownership have independent tests.
Synthetic transfers use temporary data/media folders, without user credentials or
media. Reports and captures are under `.core-build/desktop-qa/`.

`desktop:installer:test` runs the actual setup and installed executable in a new
workspace fixture, without Node/npm on its PATH. It checks checksums, the ASAR
allowlist/licenses, PE branding, per-user registration/shortcuts, Core/backend
readiness, running-app install/uninstall refusal, graceful Quit, reinstall,
uninstall retention of every profile/store byte, media retention, and reinstall
after uninstall. The test cleans up its registration/shortcuts and retains only
synthetic diagnostics under `.core-build/installer-qa/`. It refuses to overwrite
an existing real installation or user shortcuts. Run it before installing for
daily use, or in the fresh Windows CI environment.

To run packaged runtime checks against the installer payload:

```powershell
$env:CUSTOM_STREMIO_TEST_APP_DIRECTORY = '.\dist\windows-installer\win-unpacked'
pnpm desktop:test
Remove-Item Env:CUSTOM_STREMIO_TEST_APP_DIRECTORY
```

`desktop:update:test` builds A/B fixtures with a separate disposable signer, runs
the real installed updater through a failed post-install verification/restore and
a successful A-to-B upgrade, and checks retained synthetic data. Native dialogs
are adapted through the test process's local debugger; production IPC never
accepts an arbitrary file path. Fixtures never contain your personal signing key.

The Windows CI job builds/tests the installer and updater without uploading
Windows binaries. No GitHub binary release or update feed is published, and CI
cannot sign personal bundles. Live installed-account playback/sync remains
Phase 5. A fresh VM is optional extra confidence for your own machine; public
distribution/signing work is outside scope. See the
[Windows release contract](../docs/CUSTOM_STREMIO_WINDOWS_RELEASE.md) and
[upstream workflow](../docs/CUSTOM_STREMIO_UPSTREAM_UPDATES.md).
