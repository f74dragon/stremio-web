# Custom Stremio Windows launcher

Phase 2 bundles the production frontend, custom Core, local download backend, and
Electron 45.0.0 in an unpacked Windows x64 application. Node/npm and a development
web server are not needed to run it. Installer, signing, executable branding, and
automatic update delivery follow in Phases 3-4.

## Build and run

Use Node 24.19.0 and the repository's pinned pnpm 10.33.2 from the repository root:

```powershell
pnpm install --frozen-lockfile
npm ci --prefix local-backend --ignore-scripts
pnpm desktop:build
& .\dist\windows-launcher\win-unpacked\custom-stremio.exe
```

Keep the entire `win-unpacked` folder together; the executable needs its resources
and runtime files. This is an unsigned local alpha. Output is ignored by Git.
`build-info.json` inside the ASAR records source commit/dirty state and Core digest.
Build from a clean commit before distributing a release; use
`pnpm verify:release --require-clean` for source preflight.

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

## Verification

```powershell
pnpm test -- --runInBand
pnpm lint
pnpm desktop:build
pnpm desktop:test
```

`desktop:test` loads the actual packaged ASAR with Electron in an isolated profile,
uses software rendering for deterministic capture, and checks Core/WASM, sandbox,
authenticated backend access, Downloads, persistent storage, close-to-tray,
crash/retry, and graceful Quit. Only this test adapter skips the legacy-port probe
so an existing developer backend can remain running; the release launcher retains
that probe. The probe and exclusive data-root ownership have independent tests.
Synthetic transfers use temporary data/media folders, without user credentials or
media. Reports and captures are under `.core-build/desktop-qa/`.

The Windows CI job builds/tests the same app and uploads a short-lived CI artifact.
It does not publish an installer or enable updates. Installed-app playback/account
sync, upgrade/uninstall retention, source security review, signing, and A-to-B
update acceptance remain release gates. See the
[Windows release contract](../docs/CUSTOM_STREMIO_WINDOWS_RELEASE.md) and
[upstream workflow](../docs/CUSTOM_STREMIO_UPSTREAM_UPDATES.md).
