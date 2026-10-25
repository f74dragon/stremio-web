# Upstream source updates

## October 25, 2026 audit

The official remote is `https://github.com/Stremio/stremio-web.git` (`upstream`);
the fork is `https://github.com/f74dragon/stremio-web.git` (`origin`). Official
source refs were fetched for this audit without merging, checking out, replacing
dependencies, changing the current branch, or pushing.

| Reference | Commit |
| --- | --- |
| Current fork HEAD | `ed8cd5147b456d761c3b6ca8a44870c97f1ab9fb` |
| Pre-packaging source checkpoint | `bf0863a1b9f207f064b9372d63b1bffae50f7fec` |
| Shared ancestor with latest upstream release | `87ccc591dfeded23de2fde0820e4e277edc88749` |
| Upstream `v5.0.0-beta.37` | `7cb99620c543acb9888427dbbaf6eb172138e54a` |
| Latest published upstream `v5.0.0-beta.43` | `7a54709a60c6bb840b262ecaf97d874a02b23533` |
| Fetched upstream development tip | `7030b128af43afddd05d906025ecd6d99743f554` |

The shared ancestor is May 19, 2026, 18 commits after `beta.37`. A package version
label alone therefore overstates or understates the actual source baseline.
`git rev-list --left-right --count HEAD...v5.0.0-beta.43` reports 43 fork-only
commits and 648 upstream-only commits. Upstream changes 434 paths since the
shared ancestor; the source checkpoint changes 157, with 17 changed on both
sides. This is an overlap count, not a claim that Git has 17 merge conflicts.
The fetched development branch is three commits ahead of the released tag;
target a fixed release, not a moving branch, for a future integration.

## Findings and integration decision

Keep the tested current source/custom Core for the first local packaging alpha.
Do not silently merge all upstream changes as part of release-foundation work.
Upstream adoption is a separate migration with these review points:

| Area | Evidence and required treatment |
| --- | --- |
| Custom Core/account progress | Upstream release uses Core `0.65.1`; we use the vendored `0.58.0-custom.1` action extension. Port the overlay and run actual Core/storage/account-mock tests before replacing it. |
| External playback | Commit `0071d4e68` dispatches `ExternalPlayerStreamOpened`. This records the selected external stream; it is not evidence that arbitrary MPC-HC position/duration sync replaces our tested extension. Review action support and completion/rewind semantics together. |
| Routing and native shell | Upstream adopts React Router, changes the shell capabilities/init handshake, and changes remote streaming-server selection. Our future Electron bridge must stay narrow and must not impersonate WebView2/Qt transports. |
| Trust and incoming URLs | `2cf552508` and `9fdb496e3` introduce confirmation for incoming/untrusted streaming-server URLs; `8a37f050b` adjusts addon trust/config UI. Review/backport these before public distribution. They are not included by this audit. |
| Web updates | Upstream introduces `WebUpdateScreen`, Workbox window coordination, and automatic web reload/update handling. Desktop needs atomic app updates instead; packaged mode must disable the web service worker/update layer. |
| UI overlap | Both sides change MetaDetails/StreamsList, App routing, manifest/package/build files, and some shared navigation/settings paths. Preserve custom downloads, source search/filter/check cancellation, and existing UI fixes while integrating. |
| Toolchain/dependencies | Upstream `.nvmrc` is Node 22 with package engines Node >=22/pnpm >=11 and pnpm 11.8.0. This fork retains its pnpm 10.33.2 lock; Phase 1 updates the stale Node 20 `.nvmrc` to the actually tested Node 24.19.0 runtime. Use that pin for Windows CI; do not mix pnpm lock formats casually. Video moves from 0.0.79 to 0.0.101, with icon/translation changes and new React/Workbox dependencies. |

No complete dependency vulnerability audit, Core 0.65 port, or upstream merge is
claimed. Trust/URL migration, native bridge review, and the installed-app checks
in [the release contract](CUSTOM_STREMIO_WINDOWS_RELEASE.md) remain release gates.
The upstream release was verified on its
[official release page](https://github.com/Stremio/stremio-web/releases/tag/v5.0.0-beta.43).
Commit findings above were inspected from the fetched source.

## Repeatable maintenance workflow

1. Finish/checkpoint current fork work first. Record the current desktop version,
   source commit, vendored Core hash, and last passing tests. Use an isolated
   integration branch/check-out so the main packaging baseline remains recoverable.
2. Fetch official release refs. Record the exact target tag/commit and actual
   merge base; inspect commits, dependency changes, and paths overlapping custom
   work. Never treat version-label differences as a complete comparison.
3. Integrate one coherent area at a time. Resolve changes by preserving intended
   behavior, not wholesale taking one side. Keep fork code under `customStremio/`,
   `local-backend/`, and `desktop/` where practical. Make narrow backports traceable
   to the originating upstream commit and explain deviations.
4. For a Core update, inspect the current API/action surface, rebase/rework the
   source overlay, use the pinned build recipe, run the real Rust/storage/account
   mock tests, and regenerate the archive plus pnpm integrity. Preserve license
   and provenance. Ordinary frontend builds must still require no Rust/Docker.
5. Verify a frozen frontend dependency install (and backend lockfile when runtime
   packaging is implemented), frontend tests/lint/build, custom WASM smoke checks,
   source filtering/check cancellation, download/queue/history persistence,
   signed-in account progress/rewind/episode advancement, and installed Windows
   launch/recovery/update behavior. Report which live scenarios remain manual.
6. Bump our desktop version, retain upstream source attribution, generate/review
   the release artifacts, and update the project tracker with source hashes and
   actual results. Only then publish a new fork release through the approved
   binary-update channel. Automatic upstream merges or in-app source pulling are
   outside this workflow.

Useful read-only comparison commands after fetching:

```powershell
git merge-base HEAD v5.0.0-beta.43
git rev-list --left-right --count HEAD...v5.0.0-beta.43
git log --oneline --no-merges HEAD..v5.0.0-beta.43
git diff --shortstat HEAD...v5.0.0-beta.43
git diff HEAD...v5.0.0-beta.43 -- package.json webpack.config.js src/common/Platform
```

This procedure covers **getting updates from the actual source repository**.
Downloading/installing our already-tested Windows builds is a different feature;
neither workflow overwrites the other.
