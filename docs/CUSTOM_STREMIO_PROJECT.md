# Custom Stremio Project Tracker

## Project Goal

- This repo is a personal Windows-first customization of Stremio Web.
- The long-term goals are preferred-addon stream selection, one-click downloads, download progress UI, and opening completed downloads in MPC-HC.
- Normal Stremio behavior should be preserved wherever possible.

## Current Architecture Understanding

- `stremio-web` is the React frontend/client UI in this repo.
- Stremio account state, installed addons, and stream/meta data are not stored in this repo; they are loaded after login from Stremio backend/account services and addon services.
- Most UI work for this customization belongs in this repo.
- Real downloads and MPC-HC launching should later go through a local backend/native integration layer, not browser-only code.
- `stremio-core` should not be modified unless a later step proves it is unavoidable.

## Planned Architecture

`Modified stremio-web UI -> local backend/native layer later -> downloader/filesystem/MPC-HC -> optional final desktop packaging later`

## Important Files / Areas

- `src/routes/MetaDetails/MetaDetails.js`: Main meta details route. Chooses whether to show `VideosList` or `StreamsList`, loads meta details via `useMetaDetails`, and wires library/watched actions.
- `src/routes/MetaDetails/useMetaDetails.js`: Loads the `MetaDetails` model using `metaPath` and optional `streamPath`; converts released dates into `Date` objects.
- `src/routes/MetaDetails/StreamsList/StreamsList.js`: Builds the stream list UI, groups ready stream results by addon transport URL, supports addon filtering, and flattens filtered streams for rendering.
- `src/routes/MetaDetails/StreamsList/Stream/Stream.js`: Renders a playable stream entry and exposes existing deep-link related actions like play/copy stream/copy download link.
- `src/routes/MetaDetails/VideosList/VideosList.js`: Renders the episode/video list, season selection, search, watched toggles, and navigation into per-video stream view.
- `src/components/MetaPreview/MetaPreview.js`: Renders meta header details and actions such as trailer, library toggle, watched toggle, and share.
- `src/components/MainNavBars/MainNavBars.tsx`: Shared app shell navigation for major routes.
- `src/App/routerViewsConfig.js`: Top-level route-to-view mapping; confirms `MetaDetails`, `Settings`, `Player`, and other route entrypoints.
- `src/common/routesRegexp.js`: Central route patterns, including `metadetails`, `settings`, and `player`.
- `src/routes/Settings/Settings.tsx`: Settings page container using `MainNavBars`; useful later if custom app settings are needed.
- `src/routes/index.js`: Exports route components used by `routerViewsConfig`.

Notes:

- `docs/` did not previously exist and is created with this tracker file.
- There is an unrelated existing worktree modification in `package.json`; future agents should avoid touching it unless needed.

## Implementation Milestones

1. Project tracking document
2. Locate stream/title data flow
3. Preferred addon stream sorting/filtering
4. Add placeholder Download / Play Download buttons
5. Create local backend prototype
6. Implement real download manager
7. Add title-specific downloads panel
8. Add global downloads page
9. Add MPC-HC launch support
10. Add watched/unwatched integration
11. Package as Windows app

## Current Status

- `1. Project tracking document`: Completed
- `2. Locate stream/title data flow`: Completed
- `3. Preferred addon stream sorting/filtering`: Completed for the planned scope (`Milestones 3A-3A.1`; preferred ordering and persistent original Stremio addon-filter state implemented)
- `4. Add placeholder Download / Play Download buttons`: Completed and superseded by the real record-aware Download and Play controls
- `5. Create local backend prototype`: Completed and superseded by the persistent local download backend
- `6. Implement real download manager`: In progress (`Milestones 6A-6N.1` real downloads, persistence, retry/resume, FIFO scheduling, queue controls, concurrency settings, hybrid provider availability, provider-aware download safety, resolver HEAD fallback, safe local-media deletion, bulk selection/deletion, and permanent history persistence implemented)
- `7. Add title-specific downloads panel`: Completed for the planned panel scope (`Milestones 7A-7B`; later shared file-management actions remain tracked under the download manager)
- `8. Add global downloads page`: In progress (`Milestones 8A-8C.2` implemented)
- `9. Add MPC-HC launch support`: Completed for the planned scope (`Milestones 9A-9C`; panel playback, stream-row playback, and persistent in-app player selection implemented)
- `10. Add watched/unwatched integration`: Not started
- `11. Package as Windows app`: Not started

## Agent Rules

- Keep tasks small.
- Do not rewrite large areas of the app.
- Prefer minimal, reversible changes.
- Update this file after every meaningful change.
- Before changing code, identify the exact files that need edits.
- Do not touch `stremio-core` unless a future step proves it is necessary.
- Do not implement downloads in the browser directly; downloads/player launching need a local backend/native layer later.
- Preserve normal Stremio functionality.

## Next Recommended Step

Implement **Milestone 6N.2: permanent download history UI** as the next focused pass. Add a polished, poster-based History view backed by the read-only local history API, with useful date/outcome filters and title or episode details. Keep history visually and technically separate from active downloads and provider cache history.

Do not add permanent-history deletion, multi-episode downloading, watched progress, filesystem discovery, automatic provider/source switching, or Windows packaging to the History UI pass.

## Remaining Tracked Work

- Multi-episode/season batch download planning, explicit source selection, and queue submission. Do not silently choose among multiple qualities or providers without a documented selection rule.
- Permanent download history browsing UI: present the completed 6N.1 event history as poster-based titles with outcome/date filtering and detailed lifecycle events, separate from active download records, provider cache history, and future watch history.
- Watched/unwatched and playback-progress integration for real **Continue Watching**, resume position, next-episode behavior, and show-card progress.
- Filesystem discovery for media that exists without a current record, plus metadata/artwork backfill for legacy persisted records.
- Availability-history management UI, including an explicit clear-history action; current cached history remains intentionally retained by default.
- Optional automatic provider/source switching, only if the UX should select another verified source instead of asking the user.
- Explicit send-to-debrid behavior remains separate from cache checking and ordinary Stremio-link downloads.
- Windows application packaging after the local backend, download lifecycle, and playback integration are stable.

The milestone findings below are chronological implementation records. Older sections may describe a feature as deferred or unavailable at that historical point even when a later milestone subsequently implemented it; the **Current Status**, **Next Recommended Step**, and **Remaining Tracked Work** sections above are authoritative for present planning.

## Milestone 6N.1 Findings: Permanent Download History Foundation

- Download lifecycle history now lives in a separate append-only newline-delimited store at `%LOCALAPPDATA%\Custom Stremio\download-history.ndjson`. Removing active records or deleting local media never removes earlier history events.
- Events cover creation, transfer start, pause, resume, retry, completion, failure, cancellation, interrupted-backend recovery, record removal, and local-media deletion. Destructive routes must first persist a `record_removal_requested` or `media_deletion_requested` event and refuse deletion if that durable write fails.
- Each event stores an immutable privacy-safe snapshot containing title/episode identity, sanitized artwork, addon/provider/source display labels, basename-only file identity, byte totals, timestamps, attempt count, status, and error code.
- The allowlist deliberately excludes source/download/stream URLs, full local paths, behavior hints, API credentials, tokens, response validators, free-form backend errors, and other unnecessary expiring or sensitive values. Artwork query strings, fragments, and embedded credentials are stripped.
- The NDJSON reader isolates malformed, unsupported, or crash-truncated lines instead of losing valid history around them. Future events start on a fresh line, and the read API reports the number of ignored entries for later repair visibility.
- Existing active records receive one idempotent `record_backfilled` event on the first upgraded startup. New records use the same durable record-seen key, preventing duplicate backfill on later restarts.
- `GET /downloads/history` is read-only, returns newest events first, accepts an optional bounded `limit`, and is exposed through `listDownloadHistory()` for the future frontend pass. There is intentionally no clear/delete-history API.
- The 6N.1 pass establishes persistence and lifecycle evidence only; the poster-based browsing and filtering experience remains scoped to Milestone 6N.2.
- Validation: all 258 Jest tests pass across 31 suites, full frontend and focused backend ESLint pass, backend syntax checks and `git diff --check` pass, and the production build completes with only the repository's existing bundle-size warnings.

## Milestone 6M Findings: Bulk Selection and Safe Batch Deletion

- The Downloads library now has an explicit selection mode with per-title selection, **Select all**, selected-count feedback, and one destructive confirmation before any files are removed.
- Movie details support selecting individual downloaded sources or all versions. Series details group source records by episode and support individual episodes, the current season, or all downloaded episodes across seasons.
- Queued and downloading records are excluded from destructive selection. Paused, completed, failed, and canceled records remain eligible so completed media and retained partial data can be intentionally cleaned up.
- Batch work is deliberately sequential and reuses the existing per-record deletion safety boundary. The frontend does not introduce a broad filesystem or backend batch-delete primitive.
- Shared-file duplicate records are resolved only when every referenced record is part of the same confirmed selection. Duplicate metadata is removed first, allowing the final verified owner to delete the artifact; any unselected owner blocks that shortcut.
- The UI shows completed/total deletion progress. Successful records disappear as they finish, while partial failures stay visible and selected with the backend safety reason so they can be reviewed or retried.
- The global library, movie-source, episode, and season controls share the same eligibility and selection helpers, with focused coverage for grouping, sequential execution, duplicate resolution, paused-record cancellation, and unsafe shared-reference refusal.
- Validation: all 249 Jest tests pass across 30 suites, full frontend ESLint passes, the translation-string scan passes, `git diff --check` passes, and the production build completes with only the repository's existing bundle-size warnings.

## Milestone 6L Findings: Safe Local-Media Deletion

- The download manager now separates non-destructive **Remove record** from a confirmed destructive action. Completed records show **Delete download**; paused, failed, and canceled records show **Delete partial data** so retained bytes are visible and intentional.
- Pause continues to preserve `.part` data for Resume. Completed records may delete only their verified final file; paused, failed, and canceled records may delete only their verified recorded `.part` file. An unrelated final file at the same derived path is never selected by an incomplete record.
- `DELETE /downloads/:id/media` accepts only a stored id. Every candidate must be explicitly claimed by that record, match a fresh derivation from trusted metadata, remain inside the configured root after real-path resolution, and be a regular non-symbolic-link file.
- Final and partial file identities are captured when the backend creates/finalizes them and persisted with the record. Deletion and Resume refuse existing legacy, replaced, or otherwise unverifiable files; missing artifacts can still have their stale records cleared safely.
- Newly started transfers create `.part` files exclusively instead of truncating existing paths, finalization refuses to overwrite an existing destination, and Retry removes only an identity-verified partial after confirming the final destination is free.
- Deletion is blocked when another persisted record resolves to the same existing final/partial path. This protects multiple source records for the same movie or episode from silently invalidating one another. If the artifact is already missing, every stale record can be cleared without entering a shared-path deadlock.
- Lifecycle operations are serialized per record, and destination deletion locks block new same-path creation until the destructive operation and record persistence finish.
- Media deletion happens before record removal. Windows locks and filesystem errors retain the record for retry, while a missing artifact is treated as already removed. Persistence failure after successful file deletion restores an actionable failed record instead of hiding the exceptional state.
- Empty season/title directories are cleaned conservatively from the leaf upward, never recursively and never including the configured root. Nonempty folders and unrelated files remain untouched; empty-directory cleanup failure is a nonfatal warning.
- Record-only deletion rejects queued, downloading, and paused records, plus failed/canceled records that would orphan their sole partial-file claim. When multiple records claim the exact same partial path and matching persisted identity, duplicate records can be removed one at a time while the final owner retains the destructive delete action.
- API responses expose derived shared-destination and safe shared-partial-owner counts, allowing the UI to offer the duplicate escape only when ownership can remain with another verified record.
- Adversarial coverage includes unclaimed same-name files, path tampering, junction escape, identity replacement both before and during deletion, OS removal failure, existing destinations, existing `.part` files, three-record shared paths with and without a real artifact, restart persistence, completed media, and paused partial deletion.
- Bulk title/source/episode/season selection remains intentionally deferred to Milestone 6M; this pass establishes the single-record safety primitive that batch deletion will call.
- Validation after the deletion safety and duplicate-deadlock patch: all 243 Jest tests pass across 29 suites, frontend ESLint passes, the translation-string scan passes, backend syntax checks and `git diff --check` pass, and the production build completes with only the repository's existing bundle-size warnings.

## Milestone 6K.4 Findings: HEAD Resolver Fallback

- Every non-positive exact-file Real-Debrid result now triggers a second, separately visible resolver stage for that row. This includes unknown or protected-error matches as well as potentially false-negative uncached/unavailable results. A verified cached result remains authoritative. A source without an HTTP(S) Stremio download URL receives that explicit reason without making a HEAD or provider-account request.
- The fallback uses HTTP `HEAD` only, follows at most five redirects, applies five-second request timeouts, destroys responses after inspecting headers, and never attaches a body reader or writes media. This pass intentionally does not use a ranged GET.
- Torrentio `downloading_vN.mp4` becomes not cached, `failed_*_vN.mp4` and HTTP `451` become unavailable, and a final successful response with credible media headers becomes the distinct **Ready to download** state. Ready proves current link usability, not Real-Debrid cache state. It supersedes an earlier negative exact-file result and is retained for only five minutes so resolver URLs are not trusted as durable cache evidence.
- HTTP `403`, `405`, `501`, timeouts, redirect loops, malformed redirects, missing media headers, and other network ambiguity remain **Could not safely check** with the detailed reason preserved.
- The provider account is snapshotted before HEAD resolution and reconciled afterward. Only newly created exact-hash torrent IDs are added to the durable cleanup journal and deleted; pre-existing and unrelated entries remain protected.
- The UI keeps completed/total progress and changes the active row label from **Checking Real-Debrid...** to **Checking resolver link...** during the fallback. Completed rows update immediately, and the summary separates cached from link-ready results.
- Validation: all 211 Jest tests pass, frontend ESLint passes, backend syntax checks pass, and the production build completes with only the repository's existing bundle-size warnings.

## Milestone 6K.3 Findings: Provider-Aware Download Safety

- Stream rows are conservatively classified as `alldebrid`, `realdebrid`, or `unknown` from explicit stream markers and addon metadata. Conflicting or absent evidence stays unknown rather than guessing.
- Availability requests and persistent results are provider-scoped: AllDebrid checks include only AllDebrid rows, and Real-Debrid checks include only Real-Debrid rows. One provider's negative result cannot mark or disable the other provider's source URL.
- Each provider row now derives one effective readiness value: current cached, previously cached, unknown, requires caching, or unavailable. Preferred-addon grouping remains the strongest ordering rule.
- A Real-Debrid row verified not cached or unavailable is disabled just like a known-negative AllDebrid row. The button says **Not cached** or **Unavailable**, and the row explains which provider failed.
- `POST /downloads` enforces the same rule. It rejects a negative payload and also re-reads persistent provider history using the exact AllDebrid hash or Real-Debrid source-file key before accepting a job, so removing the frontend disabled state does not bypass known-negative safety.
- At the page level, a valid cache on either provider still supplies a downloadable row. A failing provider's own URL remains blocked; the app does not silently replace it with a different provider or quality.
- Known Torrentio placeholder redirects remain a final failure guard. For provider-identified resolver attempts, successful media refreshes that provider's cache history; a recognized placeholder records a short negative result. Real-Debrid resolver cleanup snapshots existing exact-hash IDs and deletes only newly created IDs if the recognized placeholder path is reached.
- Unknown or unchecked sources retain the existing behavior because absence of a result is not proof of failure.
- Episode/provider discovery now inspects `name`, legacy `title`, addon metadata, provider resolver URLs, and every external-player deep-link variant. Bare `[RD]`, `[RD+]`, `[RD Download]`, `RealDebrid`, and resolver URLs containing `realdebrid` identify Real-Debrid rows; percent-encoded resolver URLs are decoded before extracting a 40-character hash.
- A connected Real-Debrid row no longer makes its control disappear when the addon omitted a checkable hash. It displays a disabled **RD hash unavailable** state explaining why the account-mutating check cannot be performed safely.
- Torrentio `failed_*_vN.mp4` responses, including the observed `failed_infringement_v2.mp4`, are rejected before their video body is requested or written. Direct HTTP `451` media responses also fail as `SOURCE_UNAVAILABLE`. Recognized provider failures update Real-Debrid history as unavailable and run exact-ID resolver cleanup where a hash and connection are available.
- Generic file-size rejection was intentionally avoided because legitimate short-form media can be small; the deterministic failure URL and HTTP status are stronger signals.
- Corrective availability pass: `[AD+]` and `[RD+]` remain provider-identification hints, but no longer become verified cache results by themselves. Only an explicit backend check, completed media download, or durable observation can display a cached result. History loaded while browsing is labeled as previously verified rather than presented as a fresh check.
- Both provider controls remain visible for every populated stream list, including while the local backend is offline. Disconnected providers, providers absent from the current addon filter, and detected rows without a safe hash each display an explicit disabled reason instead of making the control disappear.
- Large title source lists are split client-side into the backend route limits: 100 AllDebrid hashes and 50 Real-Debrid source descriptors per request, for both passive history reads and explicit checks. HTTP validation/provider errors no longer reset the provider connection or masquerade as an offline backend; only a network-level failure does.
- Explicit checks run one visible source at a time and update the matching row as each result returns. The provider control shows completed/total progress, the active row shows which provider is checking it, and an unresolved row exposes the exact safe-matching error in its tooltip instead of leaving the user with only a title-level summary.
- Real-Debrid cleanup is per source, not deferred until the full title scan: each temporary torrent ID is removed and verified in that source check's `finally` block before the next source begins. The former all-at-once frontend response merely made the account removals appear delayed.
- Download outcomes feed back into availability immediately. `SOURCE_NOT_READY` becomes not cached; any other failed provider resolver transfer becomes unavailable. Negative download evidence replaces an older positive and clears the five-minute in-memory result so an explicit provider recheck is live. A later successful download or explicit positive check restores cached status.
- Validation: all 195 Jest tests pass, frontend ESLint passes, backend syntax checks pass, and the production build completes with only the repository's existing bundle-size warnings.

## Milestone 6K.2 Findings: Explicit Real-Debrid Source Availability

- Added a disclosed **Check Real-Debrid** action beside the existing AllDebrid control. Browsing, opening, or filtering a title reads only local history and never contacts or mutates Real-Debrid automatically.
- The check uses only documented Real-Debrid operations: snapshot the exact hash's existing account IDs, add a temporary magnet, wait for file metadata, select exactly one safely matched source file, observe its state briefly, then delete and verify the exact temporary ID.
- Availability is source-file-specific rather than hash-only. History keys combine the info hash with the Stremio `fileIdx`, filename, and video size so separate episodes/files in the same torrent do not inherit one another's result.
- File matching prefers exact path/name and size evidence, then conservative file-index or single-video fallbacks. Ambiguous multi-file torrents are left **Unknown** without selecting any file.
- Only `downloaded` with `progress: 100` is accepted as **Cached on Real-Debrid**. A persistent post-selection state such as `queued`, or observed transfer activity, is **Not cached**. HTTP `451` / provider infringement code `35` is **Unavailable**.
- Current cached, previously verified cached, unknown, not-cached, and unavailable sources receive separate badges and local ordering. Preferred-addon grouping remains the strongest sorting rule. Milestone 6K.3 later connects the provider-specific result to the matching provider row's download safety.
- Observations persist atomically in `%LOCALAPPDATA%\Custom Stremio\realdebrid-availability-history.json`: cached results expire after 30 days, history-loaded cached results are labeled **Previously cached**, not-cached results expire after 15 minutes, and unavailable results expire after 24 hours. Later definitive download/check evidence replaces older history for the same exact source file.
- Temporary torrent IDs are written to `%LOCALAPPDATA%\Custom Stremio\realdebrid-pending-cleanup.json` before file selection. Failed cleanup survives restart and is retried at backend startup; disconnect is blocked while cleanup remains pending so the credential required for deletion is preserved.
- Existing same-hash account torrents are protected. A lost add response triggers exact-hash reconciliation against the pre-check snapshot, and only newly observed IDs become eligible for cleanup.
- The disabled historical `instantAvailability` diagnostic was removed from production code and routes. It remains documented only as forensic evidence that provider error code `37` made it unusable.
- This milestone does not add a Real-Debrid download/resolver action. Actual downloads still use the original Stremio-provided URL.
- Validation: all 185 Jest tests pass, frontend ESLint passes, backend syntax checks pass, and the production build completes with only the repository's existing bundle-size warnings.

## Milestone 6K.1 Findings: Secure Real-Debrid Foundation

- Added Real-Debrid to **Downloads -> Download options**, separate from upstream Stremio Settings.
- Authentication follows the documented open-source device workflow: the backend requests a user code, polls for account-bound client credentials after user approval, exchanges the device code for access/refresh tokens, and reads the account profile.
- Client credentials, access tokens, and refresh tokens are stored only in the versioned local backend settings file. Frontend responses expose only connection, username, user ID, and premium status.
- Expired access tokens refresh through the backend with a single shared refresh operation. Disconnect revokes the current access token before removing local credentials.
- Added an explicit diagnostic for the historical `GET /torrents/instantAvailability/{hash}` route. It sends no torrent, magnet, file selection, or deletion request and is never called automatically by source browsing.
- The current official Real-Debrid method list no longer displays that instant-availability route, although its old response schema remains on the official page. Therefore this milestone does not use its results for badges, sorting, or download decisions until authenticated live verification succeeds.
- Authenticated live verification completed on July 18, 2026:
  - Account connection survived a backend restart and restored the sanitized premium account state.
  - A hash previously verified cached through AllDebrid and a deliberately nonexistent hash both reached Real-Debrid but returned provider error code `37`, `disabled_endpoint`.
  - A read-only `/torrents` snapshot contained 53 account items both before and after the probe, with the exact ID list unchanged. The probe created no account torrent.
  - Conclusion: the historical route is safely read-only but unusable. It must not power availability UI or decisions.
- Controlled documented-workflow test on July 19, 2026:
  - `addMagnet` created a visible entry in `waiting_files_selection`; this status alone did not reveal cache state and did not start peer downloading.
  - After selecting only the largest video file, the torrent reached `downloaded` with `progress: 100` in under one second and remained there through a five-second observation window. This candidate was cached on Real-Debrid even though the initial account entry looked unresolved.
  - The exact newly returned torrent ID was deleted with HTTP `204`, verified absent through `/torrents/info/{id}`, and the account torrent count returned to its original 53.
  - Conclusion: the documented add/select/info flow can positively identify an instantly cached torrent, but an uncached controlled test is still required to measure the transition and cleanup window before production implementation.
- Cross-provider candidate test on July 19, 2026:
  - All five hashes stored locally as uncached by AllDebrid were tested as controlled Real-Debrid candidates.
  - Two became `downloaded`/100% within roughly 100 ms after selection, proving that an AllDebrid-negative observation cannot be reused as a Real-Debrid-negative result.
  - Three were rejected with HTTP `451` during `addMagnet`, before a torrent ID existed; no selection, download activity, or cleanup was possible or necessary for those requests.
  - No eligible candidate entered `downloading`, so the real uncached post-selection transition remains unverified.
  - Every created test ID was deleted with HTTP `204` and verified absent. Account count remained at 53 before and after the complete test series.
- User-supplied uncached-hash test on July 19, 2026:
  - `addMagnet` produced `waiting_files_selection` with selectable video metadata.
  - At 363 ms after selecting the largest video file, Real-Debrid reported `queued` with `progress: 0` rather than the cached path's immediate `downloaded`/100% result.
  - The exact new ID was deleted with HTTP `204`; absence was verified. The complete account torrent ID list and count (55) were identical before and after.
  - The temporary entry existed for about 1.2 seconds total and was removed before any measured progress or peer speed appeared.
  - This completes live evidence for both branches: immediate `downloaded`/100% is cached; a non-downloaded post-selection state is not instant and must be cleaned up immediately.
- Existing AllDebrid behavior, preferred-addon sorting, and original Stremio download URLs remain unchanged.
- Next pass: implement the explicit, restart-safe Real-Debrid check around the now-validated cached, queued, rejection, and cleanup paths. Only `downloaded`/100% is positive; every other post-selection state is conservatively not instant and triggers exact-ID cleanup. No AllDebrid result may be assumed equivalent across providers.

## Milestone 6J Findings: Hybrid AllDebrid Availability and Resolver Cleanup

- Hash-aware stream browsing:
  - Torrent hashes are read from native `stream.infoHash` values or conservatively extracted from Torrentio download/stream/magnet URLs only when exactly one 40-character hash is present.
  - Opening or filtering a title reads only local availability history. It does not upload a magnet or contact AllDebrid.
  - Connected users receive an explicit **Check availability** control with clear disclosure that the check briefly creates and removes temporary account magnets.
  - Preferred-addon grouping remains the strongest ordering rule. Inside each addon tier, current cached, previously verified cached, unknown, and not-cached sources are ordered in that sequence.
- Persistent availability history:
  - Durable observations are stored atomically in `%LOCALAPPDATA%\Custom Stremio\alldebrid-availability-history.json` and survive backend restarts and account disconnects.
  - Positive cached observations remain useful for 30 days and are displayed as **Previously verified cached** when loaded from history. Not-cached observations expire after 15 minutes, unavailable observations expire after 24 hours, and expired or absent observations appear as unknown.
  - Explicit check results, successful real-media downloads, and known Torrentio placeholder responses all refresh the same history record.
  - Later definitive download or provider-check evidence replaces older history for the same hash, preventing a stale positive from surviving a failed resolver attempt.
  - A separate five-minute in-memory protection window prevents repeated clicks from immediately mutating the account again.
- Resolver safety:
  - Before resolving a hash-bearing stream identified as AllDebrid by its addon metadata, the backend snapshots only preexisting AllDebrid magnet IDs with that exact hash.
  - A successful media download refreshes the hash as cached and continues using the original Stremio URL.
  - A Torrentio `downloading.mp4` / `downloading_vN.mp4` redirect stops before the placeholder body is written, marks the record failed with `SOURCE_NOT_READY`, identifies newly created exact-hash magnet IDs, journals and deletes only those IDs, verifies cleanup, and stores a short not-cached observation.
  - Preexisting matching magnets and unrelated account magnets are never eligible for resolver cleanup. Failed deletions remain in the existing restart-safe cleanup journal.
  - If an explicit upload response is lost, the backend reconciles the affected hashes against the pre-check snapshot and journals/deletes any exact new IDs it can identify before returning the original error.
- Deferred:
  - Real-Debrid fallback is the next provider pass.
  - Clear availability history UI, automatic page-load provider checks, explicit send-to-debrid, batch episode/source selection, and `stremio-core` changes remain out of scope.
- Validation:
  - All 157 Jest tests pass, frontend ESLint passes, backend syntax checks pass, and the production build completes with only the repository's existing bundle-size warnings.

## Milestone 6I Findings: AllDebrid Cached Source Availability

- Verified provider contract:
  - Authenticated live testing confirmed the old undocumented `/v4.1/magnet/instant` endpoint returns `404 Endpoint doesn't exist` and is not usable.
  - The supported AllDebrid flow is PIN authentication followed by `POST /v4/magnet/upload`; its `ready` field reports whether the torrent was already available.
  - The upload response remains available only as an explicit backend capability because it mutates the account. It is not called while browsing, filtering, or sorting streams.
  - Readiness labels never unlock or replace Stremio links. The existing `externalPlayer.download` URL remains the exact source submitted to the local download scheduler.
- Secure local integration:
  - Added the current `/v4.1/pin/get` and `/v4/pin/check` flow under **Downloads -> Download options**, separate from upstream Stremio Settings.
  - The API key is returned only to and stored only by the local backend. Frontend responses expose connection/profile state but never the key.
  - AllDebrid requests are serialized and rate-limited. Input is deduplicated and restricted to valid 40-character torrent info hashes.
- Explicit temporary-magnet capability:
  - Each check snapshots pre-existing account magnet IDs before uploading, and only newly created IDs are eligible for cleanup. Existing magnets are never deleted, including an identical magnet that was already present.
  - Newly created ready and not-ready magnets are deleted immediately. Cleanup uses retries, verifies IDs are absent from a fresh status snapshot, and writes unfinished IDs to `alldebrid-pending-cleanup.json` for restart recovery.
  - AllDebrid does not provide a documented read-only cache endpoint. A not-ready upload may begin provider-side peer processing briefly before immediate deletion, so the app does not invoke this flow automatically.
  - Results use a five-minute in-memory TTL when the explicit endpoint is called.
- Safe stream and record UX:
  - Preserved `infoHash`, `fileIdx`, `behaviorHints.filename`, and `behaviorHints.videoSize` through download payloads and persistent records.
  - Torrentio `[AD+]` identifies an AllDebrid source but is not trusted as a verified cache result. A compact cached badge and cache-first ordering require a backend observation.
  - Live testing proved `[AD Download]` is not a definitive negative cache result: a row with that label can resolve to the real cached file. Those rows therefore remain **unknown**, usable, and unsorted rather than being falsely blocked.
  - Classification uses only the stream metadata already returned by the addon. Browsing and sorting make no AllDebrid or Torrentio network request and create no magnet.
  - Direct-link streams without a recognized marker remain unchanged. Local completed/downloaded state remains stronger than provider readiness.
  - The downloader inspects each redirect target before requesting its body. Torrentio `downloading.mp4` and versioned `downloading_vN.mp4` placeholders fail as `SOURCE_NOT_READY`, are never finalized as completed media, and tell the user to choose another source or retry later.
  - A provider label can become stale; the redirect guard is the final safety net for the known Torrentio placeholder family.
- Validation and remaining work:
  - Added focused coverage for PIN/auth request shapes, Bearer auth, hash validation/deduplication, ready/not-ready results, pre-existing ID protection, TTL caching, failed cleanup persistence, restart recovery, settings migration, exact Stremio download URL preservation, local marker classification, and redirect rejection before body/file writing.
  - This milestone was superseded by the hybrid persistent-history and resolver-cleanup work in Milestone 6J.
  - Real-Debrid fallback, batch episode/source selection, watched progress, filesystem discovery, metadata backfill, and media-file deletion remain separate passes.

### Live Torrentio Resolver Findings

- A ready copied Torrentio download link returned HTTP `302` to an AllDebrid media host. A one-byte range request returned HTTP `206` and a total media size of `3,593,154,342` bytes, confirming that the real file was immediately available.
- A not-ready copied Torrentio download link returned HTTP `302` to `https://torrentio.strem.fun/videos/downloading_v2.mp4`.
- Resolving that not-ready link created a new AllDebrid magnet before returning the placeholder. The account changed from 82 to 83 magnets; the new item had status `Downloading`, status code `1`, and zero downloaded bytes at observation time.
- The Torrentio download URL contained exactly one 40-character info hash, and it exactly matched the hash of the newly created AllDebrid magnet. This provides a safe association key for targeted cleanup.
- The test-created magnet was deleted by exact ID and verified absent, returning the account to 82 magnets.
- Consequence: placeholder interception prevents a bogus local media file, but it does not by itself stop provider-side processing. The production failure path should snapshot/match by extracted hash and delete only the exact new magnet created by the resolver request.

## Milestone 6H Findings: Manual Download Queue Reordering

- Persistent queue ordering:
  - Added a scheduler move operation for exact one-based positions plus complete-order restoration for persistence rollback.
  - The backend stores `queueOrder` only when the user manually changes the waiting order. Untouched and newly appended records continue using `queuedAt` FIFO.
  - Retry and Resume clear any previous manual position and enter at the back. When a queued transfer starts, its obsolete stored order is removed.
  - Restart recovery prioritizes saved manual order, preserves it for resumable partial records, and uses timestamp ordering as the legacy/default fallback.
- Reorder API and Downloads experience:
  - Added `PATCH /downloads/:id/queue` with a validated one-based `position`; only genuinely waiting queued records are accepted.
  - Expanded global activity rows now expose compact Top, Up, and Down controls where each action is valid.
  - Reorder actions use the existing per-record action lock, inline error treatment, silent refresh, and live queue-position response model.
  - Active, paused, completed, failed, and canceled records remain non-reorderable. A single waiting record shows no redundant movement controls.
- Validation and remaining work:
  - Added scheduler coverage for movement, bounds, dispatch order, complete-order restoration, and persisted manual-order sorting.
  - Added client request validation and lifecycle integration coverage for rejected active/out-of-range moves, live position changes, actual dispatch order, and persistence across backend restart.
  - Backend syntax checks pass, all 135 Jest tests pass, ESLint passes, and the production webpack build completes with only the existing bundle-size warnings.
  - Multi-title/episode batch downloads, debrid/hash availability, watched progress, filesystem discovery, metadata backfill, and media-file deletion remain separate passes.

## Milestone 6G Findings: Visible Download Queue Positions

- Live backend queue metadata:
  - `GET /downloads`, `GET /downloads/:id`, new-download responses, Retry, and Resume now decorate waiting records with a one-based `queuePosition` and current `queueLength`.
  - Position `1` means the record is next to receive a free scheduler slot. Positions are derived from the live FIFO scheduler and are never written into persistent download records.
  - The API safely represents the brief queued-to-active handoff as a queued record with no numbered position, allowing the frontend to display Starting instead of stale queue information.
- Downloads experience:
  - The global activity panel distinguishes actively downloading, queued, and paused work instead of grouping every lifecycle state under a generic Active label.
  - Waiting rows display Next in queue or their numbered position, remain ordered by the real FIFO scheduler, and retain Pause and Cancel actions.
  - Title download panels and focused movie/show detail rows use the same queue labels and expose the full `position of total` context.
  - Aggregate transfer percentage, speed, and ETA now use only genuinely downloading records, so queued and paused bytes do not distort active progress.
- Validation and remaining work:
  - Added frontend presentation coverage for active/queued/paused ordering, queue position validation, and transfer-only aggregate progress.
  - Extended backend integration coverage for initial positions, position compaction after cancellation, and Resume entering at the back of the queue.
  - Backend syntax checks pass, all 131 Jest tests pass, ESLint passes, and the production webpack build completes with only the existing bundle-size warnings.
  - Manual reordering, batch downloads, debrid/hash availability, watched progress, filesystem discovery, metadata backfill, and media-file deletion remain separate passes.

## Milestone 6F Findings: Download-Manager Concurrency Setting

- Persistent backend settings:
  - Added a separate versioned `backend-settings.json` store under the existing local backend data directory, using atomic temporary-file replacement.
  - The saved `downloads.maxConcurrentDownloads` value overrides the environment fallback on future starts. `CUSTOM_STREMIO_MAX_CONCURRENT_DOWNLOADS` remains useful only when no saved choice exists yet.
  - Invalid or unsupported settings documents stop backend startup instead of silently discarding a user's configuration.
- Runtime settings API:
  - Added `GET /settings` and `PATCH /settings` for the local download concurrency value and its accepted limits.
  - The backend accepts any positive safe integer plus the explicit `unlimited` mode, saves the new setting before applying it, and leaves the active scheduler unchanged if persistence fails.
  - Raising the limit immediately dispatches additional queued work. Lowering it does not pause or cancel existing transfers; new work waits until the active count falls below the new limit.
- Download manager experience:
  - Added a manager-local Download options panel to the global Downloads page, keeping custom download controls separate from Stremio's original Settings experience.
  - The manager offers quick choices for `1`, `2`, `3`, or `4` downloads, a validated Custom whole-number field, and an explicit Unlimited option with a resource-usage warning.
  - The control loads only when opened, saves without requiring a restart, shows an in-progress state, preserves the previous selection on failure, and offers an explicit Retry state when the backend is offline during initial load.
  - Fixed the initial UI implementation's React development lifecycle guard, which allowed `GET /settings` to finish but ignored its result and left the control stuck on Loading.
  - The UI explains that changes apply immediately without interrupting active transfers.
- Tests and remaining work:
  - Added settings-store coverage for fallback, persistence, malformed documents, and invalid values.
  - Added scheduler coverage for increasing and decreasing live concurrency plus API integration coverage for immediate dispatch and saved-value restoration after restart.
  - Backend syntax checks pass and all 129 Jest tests pass. ESLint and the production webpack build pass with only the existing bundle-size warnings.
  - Visible queue positions are the next focused UI pass. Manual reordering, batch downloads, and broader download-folder/player settings remain separate work.
  - Debrid/hash availability, watched progress, filesystem discovery, metadata backfill, and media-file deletion remain tracked for later passes.

## Milestone 6E Findings: FIFO Download Queue and Concurrency Control

- Scheduler foundation:
  - Added an isolated backend scheduler that dispatches download tasks in first-in, first-out order without changing the downloader's byte-transfer responsibilities.
  - The backend runs at most two transfers concurrently by default. `CUSTOM_STREMIO_MAX_CONCURRENT_DOWNLOADS` accepts a positive integer or `unlimited`; missing or invalid values safely use the default.
  - `GET /health` now reports the configured limit plus current active and queued counts for local diagnostics.
  - New records include `queuedAt`, and Retry/Resume refresh it when the existing record enters the back of the queue again.
- Lifecycle integration:
  - New downloads, retries, and resumes all pass through the same scheduler instead of starting directly.
  - Completing or failing an active transfer releases its slot. Pausing or canceling an active transfer releases its slot after the transfer state is finalized, allowing the next waiting job to start.
  - Pausing, canceling, or deleting a waiting record removes it from the scheduler before it can open a source request.
  - The existing frontend already renders `queued` records, polls while queued/downloading work exists, and exposes Pause/Cancel, so this backend pass required no new UI action model.
- Persistence and restart behavior:
  - Records that were genuinely waiting remain `queued` across backend restarts and are restored in `queuedAt` order.
  - Records that were actively `downloading` when the process stopped still recover as `paused`, preserving the explicit user-controlled resume behavior from Milestone 6D.
  - A queued resumed transfer revalidates its partial file on startup before it is allowed back into the scheduler; invalid partial state is kept paused with an actionable error.
  - Shutdown stops new dispatch before the final record flush so waiting work cannot accidentally start while the process is closing.
- Tests and remaining work:
  - Added unit coverage for concurrency limits, FIFO order, queued removal, failure slot release, shutdown dispatch blocking, configuration parsing, and persisted ordering.
  - Added API integration coverage proving a waiting job does not contact its source early, queued cancellation never starts, Pause hands the slot to the next job, Resume re-enters the queue, and waiting jobs survive restart.
  - Backend syntax checks pass and all 118 Jest tests pass. ESLint and the production webpack build also pass with only the existing bundle-size warnings.
  - Frontend Settings for the concurrency value, visible queue positions, manual queue reordering, and batch downloads remain separate passes.
  - Debrid/hash availability, watched progress, filesystem discovery, metadata backfill, and media-file deletion remain tracked for later passes.

## Milestone 6D Findings: Pause, Resume, and Partial-File Recovery

- Resumable transfer engine:
  - New transfers write to a sibling `.part` file and move that file to the final media path only after the response completes successfully.
  - Pausing preserves the partial file and its trusted byte count. Resuming derives the path from stored media metadata, measures the actual partial file, and requests the remaining bytes with an HTTP `Range` header.
  - Non-zero resumes require a `206 Partial Content` response whose `Content-Range` starts at the requested byte. A source that ignores the range and returns `200` fails safely without appending duplicate data.
  - Strong `ETag` or `Last-Modified` validators are retained when available and sent with `If-Range` so a changed remote representation is not silently joined to old partial bytes.
  - A valid `416` response whose complete length exactly matches the existing partial file can finalize the transfer safely.
- Backend lifecycle and persistence:
  - `POST /downloads/:id/pause` now pauses queued/downloading records; `POST /downloads/:id/resume` validates and restarts paused records from the measured partial-file offset.
  - Cancel works for paused records and preserves the partial artifact. Retry remains the explicit restart-from-zero path and removes both the derived final file and `.part` artifact first.
  - Records interrupted by backend shutdown are restored as `paused`, not `failed`, so the user can explicitly resume them after restart. Existing paused records remain paused.
  - Transfer progress after resume uses session bytes for speed calculation while preserving total downloaded bytes and overall progress.
- Frontend controls:
  - Title download rows, focused Downloads details, and the global activity panel now expose Pause or Resume according to record state, alongside existing Cancel/Retry actions.
  - Paused records remain visible as active work but do not keep background polling alive when no transfer is currently running.
  - Action locking and inline errors use the existing lifecycle-control treatment so repeated clicks cannot launch conflicting operations.
- Validation and remaining work:
  - Added unit coverage for resume eligibility, trusted partial-file sizing, range parsing, and resumed progress calculations.
  - Added backend integration coverage for pause/resume byte integrity, `Range` plus `If-Range`, successful completion, and safe failure when a source ignores byte ranges.
  - Backend syntax checks and ESLint pass, all 110 Jest tests pass, and the production webpack build completes with only the existing bundle-size warnings.
  - Queue ordering and configurable concurrency are the next lifecycle pass. Multi-file selection can build on that scheduler.
  - Debrid/hash availability, watched progress, filesystem discovery, metadata backfill, and media-file deletion remain tracked for later passes.

## Milestone 6C.1 Findings: Retry Failed and Canceled Downloads

- Backend lifecycle:
  - Added `POST /downloads/:id/retry` for inactive `failed` and `canceled` records. Active and completed records return a conflict instead of starting an invalid duplicate transfer.
  - Retry reuses the existing record id and preserves title, episode, artwork, source, and destination metadata so failed rows do not accumulate as duplicates.
  - Progress, byte totals, speed, ETA, completion time, and error state reset before the record returns to `queued`.
  - New records track `attemptCount` and `lastAttemptAt`; legacy records remain compatible and treat their first retry as attempt two.
- File and persistence safety:
  - The retry destination is derived from trusted record metadata rather than accepting the stored or caller-supplied path as a deletion target.
  - A stale partial artifact at that derived destination is removed before retrying, and a cleanup failure leaves the record failed/canceled with an actionable API error.
  - The reset `queued` record is persisted before the background transfer restarts. Persistence failure restores the previous in-memory record and does not launch the retry.
- Frontend behavior:
  - Failed and canceled records expose a shared `Retry` action in both title-specific panels and focused global Downloads details.
  - Retry uses the same per-record action lock and inline failure treatment as Cancel, Play, Open Location, and Remove Record.
  - Successful retry immediately updates the existing row; normal active polling then supplies live progress and the global activity bar.
- Tests and remaining work:
  - Added coverage for retry status guards, legacy attempt metadata, trusted derived-path cleanup, transfer-state reset, and completed-file protection.
  - Added an end-to-end backend test that fails a real local HTTP transfer, retries the same record after the source recovers, and verifies the completed replacement file.
  - Full ESLint passes, all 100 Jest tests pass, backend syntax checks pass, and the production webpack build completes with only the existing size warnings.
  - Pause/Resume remains deferred until the downloader supports validated HTTP byte ranges, append-safe writes, partial-file state, and restart recovery.
  - Queue ordering and configurable concurrency follow resumable transfers; debrid/hash availability, watched progress, filesystem discovery, and media-file deletion remain tracked.

## Milestone 8C.2 Findings: Global Download Activity and Library Status Polish

- Global activity:
  - Active transfers now produce one compact, byte-weighted progress bar at the top of the Downloads page instead of a redundant Active count chip.
  - The aggregate percentage uses total downloaded bytes divided by total expected bytes across all active transfers. It becomes indeterminate when any active response has no known total rather than displaying a misleading percentage.
  - Expanding the bar shows every active file with title/episode context, individual progress, transferred size, combined speed/ETA context, action errors, and the existing real Cancel action.
  - The activity bar remains available while browsing a focused movie/show detail page.
- Poster library cleanup:
  - Removed the explanatory page paragraph, media-type subtitle, and separate details chevron. The poster is the single entry point into title details.
  - Increased spacing above the poster grid so hover elevation does not crowd the section description.
  - Downloading movies show a circular progress treatment in the poster's top-right; completed movies show the direct Play control instead of a redundant Ready badge.
  - Shows display a unique downloaded-episode count in the top-right. Attention remains a separate warning only when a record actually needs intervention.
- Season browsing:
  - Show details now separate records with a season selector and display one season at a time.
  - Records without season metadata remain accessible under `Other episodes`.
  - Episode badges count unique episodes rather than duplicate local versions of the same episode.
- Deferred transfer controls:
  - Cancel is available now because the backend can abort an active transfer safely.
  - Retry should be the next small lifecycle feature for failed/canceled records.
  - Real Pause/Resume requires byte-range requests, resumable partial-file state, validation of remote range support, and restart recovery; the current placeholder endpoints must continue returning `501` until that backend work is complete.
  - Queue ordering, multi-file batch downloads, and a user-selectable concurrency limit (`1`, `2`, or more simultaneous transfers) follow the resumable-transfer work.
  - Watched/continue state, debrid/hash availability, metadata backfill, media-file deletion, filesystem discovery, and automatic partial-file cleanup remain tracked and deferred.

## Milestone 8C.1 Findings: Downloads Detail Polish

- Rich title metadata:
  - New download records now preserve the title logo, summary, runtime, release information, released date, and Stremio metadata links in addition to poster/background/episode artwork.
  - The focused detail hero derives and displays year/release range, runtime, IMDb score, genres, cast, and directors from the same metadata used by the normal Stremio title page.
  - Older persisted records remain valid but are not retroactively enriched; their detail pages omit metadata that was not present when they were created.
- Interaction and layout:
  - Clicking the poster surface or title enters the focused detail view, while the explicit poster Play button remains the movie quick-play action.
  - Replaced the always-visible Titles/Active/Ready/Needs Attention dashboard with a compact contextual strip that appears only for active transfers or records needing attention.
  - Added responsive content gutters and contained the detail hero so controls and text no longer sit directly against viewport edges.
- File location:
  - Added `POST /downloads/:id/open-location` and a detail-row `Open location` action.
  - The backend resolves the path only from the stored record, selects an existing media file in Windows File Explorer, and otherwise opens its known parent folder.
  - Arbitrary caller-supplied filesystem paths are not accepted.
- Validation:
  - Added File Explorer launcher tests plus rich metadata payload/grouping/persistence coverage.
  - Full ESLint passes, all 92 Jest tests pass, backend syntax checks pass, and the production webpack build completes with only the existing size warnings.

## Milestone 8C Findings: Streaming-Style Library Navigation

- Library navigation:
  - Movies and shows are now presented as poster media cards rather than visible download jobs.
  - Removed inline card expansion/accordions. A separate focused title view prevents one show from creating an indefinitely tall mixed-title library page.
  - Returning from the focused title view restores the previous library-grid scroll position.
- Movie behavior:
  - A movie card's primary poster/title action plays the newest completed local file immediately.
  - The newest completed selection is deterministic and ignores newer active/failed records.
  - A separate chevron opens the focused title view to choose another version or manage active/failed records; single-file movies no longer require an episode-style expansion interaction.
  - Active or failed movies without a playable record open their focused detail view instead of offering a misleading Play action.
- Show behavior:
  - A show's primary Browse Episodes action and secondary chevron open a focused title view containing its downloaded episodes.
  - Episode lists no longer expand inside the main poster grid.
  - Episode rows prioritize thumbnail, episode title, season/episode number, file size, playable state, and a direct Play action.
  - The future primary Continue/Play action should use watched/progress history to select the correct episode and resume point. Do not guess and label an arbitrary episode as Continue before that data exists.
  - Until history integration is implemented, the show card uses the safe Browse Episodes label and does not guess a continuation target.
- Card and detail presentation:
  - Added a clear primary action overlay to posters and a visually separate chevron for entering title details.
  - Long media and episode titles are clamped to the available width while preserving full text through labels/tooltips.
  - Default record surfaces show thumbnail, title, season/episode, file size, progress/state, and primary actions.
  - Addon name, stream name, local path, and timestamps now live behind a secondary `Download info` disclosure.
  - Existing Play, Cancel, and Remove Record actions remain available, including the explicit notice that removing a record leaves the media file on disk.
- Tests and validation:
  - Added coverage for newest-completed playback selection, title-level Stremio links, and media-group playable-record presentation.
  - ESLint, the complete Jest suite, and the production webpack build pass.
- Future integration points:
  - Watched/progress integration supplies Continue Watching target selection, resume time, progress bars, and next-episode behavior.
  - Debrid/hash availability should decorate the stable poster/title/detail model instead of adding more information to raw download cards.
  - The title view should be designed so movie versions, episode downloads, availability, and later file-management actions can coexist without returning to inline accordions.

## Milestone 8B Findings: Media-First Downloads Library

- Artwork data flow:
  - Added optional `poster`, `background`, and `videoThumbnail` fields to the frontend download payload and backend record shape.
  - New records preserve title and episode artwork through the existing persistent record store without a storage-version migration.
  - Existing records remain compatible; missing artwork uses a branded fallback instead of breaking or hiding the record.
- Media grouping:
  - The global Downloads page now groups records by `type + metaId`, with a normalized title fallback for legacy records lacking an id.
  - Each movie/show is represented once with a poster-led media card rather than being repeated across flat status sections.
  - Groups are ordered by latest activity; series episodes are ordered by season and episode for predictable browsing.
- Browsing and actions:
  - Selecting a title expands its movie/episode downloads with landscape thumbnails, progress, status, errors, file information, and existing Play/Cancel/Remove controls.
  - Active title groups start expanded so transfer progress remains visible.
  - Cards expose aggregate Active, Ready, and Needs Attention counts and retain a link to the matching Stremio title or episode.
  - Responsive layouts preserve the poster hierarchy and collapse detail rows cleanly on smaller screens.
- Tests:
  - Added payload coverage for optional artwork metadata.
  - Added media grouping, aggregate-state, series ordering, legacy fallback, and non-mutation coverage.
  - Extended persistence coverage to confirm artwork survives record-store round trips.
- Deferred behavior:
  - Existing persisted records are not retroactively backfilled from Stremio metadata; they use artwork fallbacks. Downloads created after this milestone carry artwork automatically.
  - Debrid/hash availability, metadata backfill, open folder, pause/resume, watched integration, media-file deletion, and filesystem discovery remain deferred.

## Milestone 8A Findings: Global Downloads Library

- New route and navigation:
  - Added `#/downloads` to the application router and route-regexp coverage.
  - Added a Downloads destination to the shared desktop/mobile navigation using the existing Stremio download icon.
  - The generic navigation tab supports an explicit inactive icon for icon families without an `-outline` variant.
- Shared frontend architecture:
  - Added `src/customStremio/useDownloadRecords.js` as the shared controller for title-specific and global record queries.
  - Initial loading, silent polling, identical-snapshot suppression, offline record retention, and per-record action locks/errors now have one implementation.
  - Migrated `MetaDetails` to the shared controller while preserving title-panel and stream-row record state.
  - Added a shared responsive `DownloadRecordCard` used by both the title panel and global library.
- Global library behavior:
  - Added summary counts and separate `Active`, `Ready to play`, and `Needs attention` sections.
  - Records are sorted newest-first inside each section and link back to their title/episode when metadata is available.
  - The page polls only while active records exist, keeps visible records during backend outages, and supports manual refresh/retry.
  - Existing Play, Cancel, and Remove Record actions are available with per-record busy and error feedback.
  - Removing a record continues to preserve its media file.
- Presentation:
  - Responsive one/two/three-column record layout with streaming-library hierarchy, progress bars, status badges, compact summaries, and purposeful loading/empty/offline states.
  - The existing title-specific panel uses the compact variant of the same card.
- Known UX limitation and follow-up:
  - Current records do not contain poster or episode-thumbnail metadata, so the global page is still text/record-oriented and downloads from different titles share the same flat status sections.
  - The next pass should add media artwork to the frontend payload/backend record, preserve it through persistence, and group the library by movie/show with expandable or clearly nested episodes.
  - This media-first pass should happen before debrid/hash highlighting so later availability states attach to a stable, browseable library design.
- Tests:
  - Added pure coverage for record grouping, newest-first sorting, and title/episode detail links.
  - Extended route tests for the exact `/downloads` route.
- Deferred behavior:
  - Debrid/hash availability, open folder, pause/resume, watched integration, media-file deletion, and filesystem discovery remain deferred.
  - No backend or `stremio-core` files were changed in this milestone.

## Milestone 6B Findings: Persistent Download Records

- Files changed:
  - `local-backend/downloadRecordStore.js`
  - `local-backend/server.js`
  - `local-backend/README.md`
  - `tests/downloadRecordStore.spec.js`
  - `docs/CUSTOM_STREMIO_BACKEND_API.md`
  - `docs/CUSTOM_STREMIO_PROJECT.md`
- Storage behavior:
  - Download metadata is stored in a versioned JSON document under `%LOCALAPPDATA%\Custom Stremio` by default.
  - `CUSTOM_STREMIO_DATA_DIR` can override the metadata directory without changing the media download folder.
  - Writes use atomic temporary-file replacement and debounce frequent progress updates.
  - New queued records are persisted before their background transfer begins.
- Restart recovery:
  - Completed, failed, and canceled records are restored and remain visible after backend restart.
  - Completed records remain available to both panel and stream-row Play actions when the media file exists.
  - Interrupted queued/downloading/paused records are restored as `failed` with an explicit interruption error because resume is not implemented.
  - Removed records are omitted from persistent storage while their media files remain untouched.
  - Invalid or unsupported metadata documents stop startup instead of being silently overwritten.
- Upgrade note:
  - The first restart from the old in-memory backend cannot recover records that the old process never wrote; persistence applies to records created or visible after the updated backend starts.
- Deferred behavior:
  - Automatic resume, partial-file cleanup, global downloads UI, open folder, watched integration, and debrid/hash availability remain deferred.

## Milestone 9C Findings: Persistent In-App Video Player Selection

- Player selection now lives in the fork-owned **Downloads -> Download options** interface rather than upstream Stremio Settings.
- A backend-owned native Windows file dialog lets the user point directly to an `.exe`; browser file inputs are not used because they hide the real local path.
- The backend validates that the selection is an absolute, existing `.exe` file before atomically persisting it in `backend-settings.json`.
- The saved selection applies to the next Play action immediately and survives backend restarts. No server restart or environment setup is required.
- Existing concurrency and AllDebrid settings preserve the player path when they are changed, and version-one/version-two settings migrate without losing their existing values.
- `CUSTOM_STREMIO_PLAYER_PATH` remains a backward-compatible startup fallback only when no saved player selection exists. No installation directories are scanned or guessed.
- The selector endpoint is protected by the trusted-local-origin policy, launches PowerShell without a shell command, and passes the initial directory through an environment value rather than interpolating paths into script source.
- Validation: all 164 Jest tests, frontend ESLint, backend syntax checks, diff checks, and the production build pass; webpack reports only the repository's existing bundle-size warnings.

## Milestone 9B Findings: Play Completed Downloads from Stream Rows

- Files changed:
  - `src/routes/MetaDetails/MetaDetails.js`
  - `src/routes/MetaDetails/StreamsList/StreamsList.js`
  - `src/routes/MetaDetails/StreamsList/Stream/Stream.js`
  - `src/routes/MetaDetails/StreamsList/Stream/styles.less`
  - `docs/CUSTOM_STREMIO_PROJECT.md`
- Completed stream behavior:
  - A matching completed download now shows a prominent `Play Download` control instead of a passive `Downloaded` state.
  - Selecting it uses the same verified backend `/play` action and configured MPC-HC path as the title downloads panel.
  - The control shows `Opening...` and becomes temporarily unavailable while the launch request is active.
  - Playback failures appear inline on the affected stream row and remain visible in the downloads panel through shared per-record error state.
- Interaction safety:
  - The download/play control prevents the parent stream row click, so launching the local file does not also open the original remote stream.
  - Panel and stream-row controls share one per-record action lock, preventing concurrent play/remove actions for the same record.
  - Queued, downloading, and paused rows remain status-only controls; new streams retain the existing Download behavior.
- Deferred behavior:
  - Persistent records, global downloads, open folder, watched integration, and debrid/hash availability remain deferred.

## Milestone 9A Findings: Play Completed Downloads from the Panel

- Files changed:
  - `local-backend/playerLauncher.js`
  - `local-backend/server.js`
  - `local-backend/README.md`
  - `src/customStremio/localBackendClient.js`
  - `src/customStremio/components/TitleDownloadsPanel.js`
  - `src/customStremio/components/TitleDownloadsPanel.less`
  - `src/routes/MetaDetails/MetaDetails.js`
  - `docs/CUSTOM_STREMIO_BACKEND_API.md`
  - `docs/CUSTOM_STREMIO_PROJECT.md`
- Player configuration:
  - This original environment-only setup was superseded by the persistent in-app selector in Milestone 9C.
  - No installation-directory scanning or guessed executable paths are used.
  - Current development path: `C:\Program Files\MPC-HC\mpc-hc64.exe`.
- Playback safety:
  - `POST /play` accepts a stored `downloadId` only and never accepts an arbitrary caller-provided local path.
  - Only completed records can be played.
  - The configured player and downloaded media path must both exist as regular files.
  - MPC-HC is launched directly with the media path as one argument and without a shell.
- Panel behavior:
  - Completed records expose a primary `Play` action alongside `Remove record`.
  - Playback uses the same per-record action lock and inline error treatment as cancel/remove.
  - The button shows `Opening...` while the backend launch request is pending.
- Deferred behavior:
  - Stream-row `Downloaded` controls are unchanged in this pass.
  - Open folder, persistent records, watched integration, and debrid availability remain deferred.

## Development Environment Cleanup: Portable Local HTTPS

- `webpack.config.js` remains a tracked project file and no longer has unrelated whole-file formatting churn.
- The development server uses the ignored `localhost+2-key.pem` and `localhost+2.pem` trusted certificate pair when both files are available.
- Fresh clones without the local certificate pair fall back to webpack-dev-server's generated HTTPS certificate instead of failing to start.
- The certificate and private-key files remain ignored and must not be committed.
- Removed the ineffective `webpack.config.js` entry from `.gitignore`; tracked build configuration should stay versioned.

## Milestone 6A.3 Findings: Download Record Controls

- Files changed:
  - `src/customStremio/components/TitleDownloadsPanel.js`
  - `src/customStremio/components/TitleDownloadsPanel.less`
  - `src/routes/MetaDetails/MetaDetails.js`
  - `docs/CUSTOM_STREMIO_PROJECT.md`
- Record controls:
  - Active `queued`, `downloading`, and `paused` records expose a `Cancel` action.
  - Terminal `completed`, `failed`, and `canceled` records expose a `Remove record` action.
  - Removing a record only removes it from the backend's in-memory list; downloaded files remain on disk.
- Interaction behavior:
  - Actions use the existing local backend cancel/delete endpoints and keep the current list rendered while requests run.
  - Each record gets its own `Canceling...` or `Removing...` busy state so unrelated records remain interactive.
  - Action failures appear inline on the affected record without replacing the downloads panel or interrupting polling.
  - Successful actions update the shared record snapshot immediately and then perform a silent refresh so the panel and stream-row button states remain synchronized.
- Deferred behavior:
  - No playback, open-folder, persistence, pause/resume, file deletion, or debrid availability behavior was added in this milestone.

## Milestone 6A.2 Findings: Smooth Download Polling UI

- Files changed:
  - `src/customStremio/components/TitleDownloadsPanel.js`
  - `src/customStremio/components/TitleDownloadsPanel.less`
  - `src/routes/MetaDetails/MetaDetails.js`
  - `docs/CUSTOM_STREMIO_PROJECT.md`
- Polling behavior:
  - Title download polling no longer clears or reloads the panel on each refresh.
  - The full loading state is now reserved for the initial load when no records have been shown yet.
  - Background polling keeps the existing records rendered and updates status/progress in place.
- Offline/error behavior:
  - If the backend becomes unavailable after records are already visible, the panel keeps the last visible records and shows a small inline error note instead of replacing the whole panel.
  - A subtle `Refreshing...` indicator can appear during background refreshes without flashing the list.

## Milestone 6A.1 Findings: Series Folder Naming and Polling Fix

- Files changed:
  - `src/customStremio/downloadPayload.js`
  - `src/customStremio/components/TitleDownloadsPanel.js`
  - `src/routes/MetaDetails/MetaDetails.js`
  - `src/routes/MetaDetails/StreamsList/StreamsList.js`
  - `local-backend/fileUtils.js`
  - `local-backend/server.js`
  - `docs/CUSTOM_STREMIO_BACKEND_API.md`
  - `docs/CUSTOM_STREMIO_PROJECT.md`
- Metadata change:
  - Added `parentTitle` to the download payload and backend record shape.
  - For movies it carries the movie title.
  - For series it carries the parent show title, while `videoTitle` remains the episode title.
- Folder naming fix:
  - Movie downloads now use the parent/movie title for the top-level folder and file base name.
  - Series downloads now use the show title for the top-level folder, keep `Season 01` style season folders, and keep `S01E01 - Episode Title.ext` style file names.
- Polling change:
  - Title-level download records are now loaded and polled from `MetaDetails` so both the downloads panel and stream-row button states use the same backend snapshot.
  - Polling runs only while a title has active `queued`, `downloading`, or `paused` records.
  - Polling stops on unmount and after backend errors to avoid unnecessary request spam.
- Button state result:
  - Stream-row buttons should now move from `Downloading` to `Downloaded` after backend completion because the shared records refresh while active downloads exist.

## Milestone 6A Findings: Real Backend File Downloading

- Files changed:
  - `local-backend/server.js`
  - `local-backend/downloadManager.js`
  - `local-backend/fileUtils.js`
  - `local-backend/README.md`
  - `docs/CUSTOM_STREMIO_BACKEND_API.md`
  - `docs/CUSTOM_STREMIO_PROJECT.md`
- Current backend behavior:
  - The local backend now performs real direct `http`/`https` file downloads in the background after `POST /downloads`.
  - The record is returned immediately as `queued`, then updates in memory through `downloading`, `completed`, `failed`, or `canceled`.
  - Duplicate prevention remains backend-side and unchanged.
- Progress fields:
  - `bytesDownloaded`
  - `bytesTotal`
  - `progress`
  - `speedBytesPerSecond`
  - `etaSeconds`
  - `completedAt`
  - `localPath`
- Default download folder:
  - `%USERPROFILE%\Downloads\Stremio Downloads`
  - Development override: `CUSTOM_STREMIO_DOWNLOAD_DIR`
- Current limitations:
  - direct-file downloads only for `http` and `https`
  - pause/resume are still not implemented and now return honest `501` responses
  - partial files may remain after cancel or failure
  - records and active downloads are still in-memory only

## Milestone 5G Findings: Record-Aware Download Button State

- Files changed:
  - `src/customStremio/downloadRecordMatching.js`
  - `src/routes/MetaDetails/StreamsList/StreamsList.js`
  - `src/routes/MetaDetails/StreamsList/Stream/Stream.js`
  - `src/routes/MetaDetails/StreamsList/Stream/styles.less`
  - `docs/CUSTOM_STREMIO_PROJECT.md`
- Matching helper:
  - Added `src/customStremio/downloadRecordMatching.js` to keep frontend record matching aligned with backend duplicate logic.
  - It exposes:
    - `getPayloadSourceUrl(payload)`
    - `getRecordSourceUrl(record)`
    - `isActiveDownloadRecord(record)`
    - `doesRecordMatchPayload(record, payload)`
    - `findMatchingDownloadRecord(records, payload)`
- Button states:
  - `Download`
  - `Adding...`
  - `Queued`
  - `Downloading`
  - `Paused`
  - `Downloaded`
- Current behavior:
  - `StreamsList` now loads current backend records for the active `metaId` and computes a matching record for each stream payload.
  - Matching mirrors the backend duplicate rule:
    - source URL priority is `downloadUrl -> streamingUrl -> streamUrl -> externalUrl`
    - active statuses are `queued`, `downloading`, `paused`, and `completed`
    - matching uses `metaId + videoId + sourceUrl` when `videoId` exists
    - otherwise matching falls back to `metaId + type + sourceUrl`
  - Stream buttons with an active matching record now render a stateful label and avoid sending another create request from the button click.
  - New create requests temporarily show `Adding...` until the backend responds, then settle into the matched backend status.
- Deferred behavior:
  - Progress visuals, cancel controls, and play-open actions for completed downloads are still deferred until real backend downloading exists.
  - This milestone only reduces duplicate-click confusion and makes the button state reflect known backend records.

## Milestone 5F Findings: Frontend Duplicate Download Status

- Files changed:
  - `src/routes/MetaDetails/StreamsList/StreamsList.js`
  - `docs/CUSTOM_STREMIO_PROJECT.md`
- Current behavior:
  - The frontend now checks `record.duplicate` after `createDownload(payload)` returns.
  - New backend records log `customStremio.downloadCreated`.
  - Duplicate backend responses log `customStremio.downloadDuplicate`.
  - Existing backend errors still log `customStremio.downloadCreateError`.
- Visible status message:
  - Added a temporary user-visible status message in `StreamsList` as a fixed top-center toast/pill overlay.
  - Messages are:
    - `Download queued.`
    - `Already added.`
    - `Download backend unavailable.`
  - The message auto-clears after a few seconds and now animates in/out without depending on the stream sidebar width.
- Refresh behavior:
  - The title downloads panel still refreshes after both new and duplicate backend responses.

## Milestone 5E Findings: Backend Duplicate Download Prevention

- Files changed:
  - `local-backend/server.js`
  - `local-backend/README.md`
  - `docs/CUSTOM_STREMIO_BACKEND_API.md`
  - `docs/CUSTOM_STREMIO_PROJECT.md`
- Duplicate matching rule:
  - active duplicates are matched backend-side using `metaId + videoId + sourceUrl`
  - when `videoId` is missing, matching falls back to `metaId + type + sourceUrl`
  - only statuses `queued`, `downloading`, `paused`, and `completed` block a new create
  - `canceled`, `failed`, and `deleted` records do not block a new create
- Current behavior:
  - duplicate `POST /downloads` requests now return the existing record with HTTP `200` and `duplicate: true`
  - new records still return a created record with `duplicate: false`
- Limitations:
  - duplicate prevention is still in-memory only
  - backend restarts clear the duplicate history
  - no real file downloading yet

## Milestone 7B Findings: Resizable Stream Sidebar

- Files changed:
  - `src/routes/MetaDetails/MetaDetails.js`
  - `src/routes/MetaDetails/styles.less`
  - `docs/CUSTOM_STREMIO_PROJECT.md`
- Current behavior:
  - The per-video stream sidebar no longer uses a fixed desktop width only.
  - A drag handle now appears on the left edge of the stream sidebar on desktop.
  - Dragging the handle resizes the sidebar width within bounded min/max values so long stream titles and controls have more room.
  - The selected width is persisted in local storage using `customStremio.streamsSidebarWidth`.
- Limits:
  - Desktop-only interaction
  - Mobile layout keeps the existing stacked behavior and disables the resize handle
- Safety:
  - Stream playback behavior, preferred-addon sorting, and the download panel flow are unchanged.

## Milestone 7A Findings: Title Downloads Panel

- Files changed:
  - `src/customStremio/components/TitleDownloadsPanel.js`
  - `src/customStremio/components/TitleDownloadsPanel.less`
  - `src/routes/MetaDetails/StreamsList/StreamsList.js`
  - `docs/CUSTOM_STREMIO_PROJECT.md`
- Panel behavior:
  - Adds a compact title-level downloads panel on the per-video stream page when `metaId` is available.
  - The panel calls `listDownloads(metaId)` on mount and whenever `metaId` changes.
  - It shows loading, offline/error, empty, and populated states.
  - It includes a manual `Refresh` button.
  - It displays each record's title, addon name, stream name, status, progress, local path when present, and created timestamp when present.
- Backend requirements:
  - The local backend must be running at `http://127.0.0.1:5577` for the panel to load records.
- Auto-refresh:
  - After a successful `createDownload(payload)` call from the existing Download button, `StreamsList.js` increments a local refresh key so the panel reloads automatically.
- Layout adjustment:
  - The title downloads panel was revised again so it now renders below `Summary` inside `MetaPreview`, above the trailer/library/share controls.
  - Panel visibility no longer depends on the extra middle spacing column or browser zoom level.
- Limitations:
  - Display-only prototype UI
  - No pause/resume/cancel controls yet
  - No global downloads page yet
  - Backend records are still in-memory only, so they disappear when the backend restarts

## Milestone 5D Findings: Download Button Backend Call

- Files changed:
  - `src/routes/MetaDetails/StreamsList/StreamsList.js`
  - `docs/CUSTOM_STREMIO_PROJECT.md`
- Current behavior:
  - The existing Download button still logs `customStremio.downloadPlaceholder`.
  - After logging the placeholder payload, it now calls the local backend with `createDownload(payload)`.
  - On success it logs `customStremio.downloadCreated` with the created queued backend record.
  - On failure it logs `customStremio.downloadCreateError` with a useful message, status, and backend error when available.
- Runtime requirements:
  - The local backend must be running at `http://127.0.0.1:5577` for backend record creation to succeed.
- Error behavior:
  - If the backend is offline or returns an error, the UI does not crash.
  - The placeholder payload log still appears even when backend creation fails.
- Current limitations:
  - No real downloading yet
  - No download progress panel yet
  - No duplicate-click protection yet; rapid repeated clicks can create multiple queued records until a later milestone addresses it

## Milestone 5C Findings: Frontend Local Backend Client

- Created utility file: `src/customStremio/localBackendClient.js`
- Exported functions:
  - `getBackendHealth()`
  - `createDownload(payload)`
  - `listDownloads(metaId)`
  - `getDownload(id)`
  - `pauseDownload(id)`
  - `resumeDownload(id)`
  - `cancelDownload(id)`
  - `deleteDownload(id)`
- Shared helper:
  - `requestJson(path, options)`
- Behavior notes:
  - Uses the local backend base URL `http://127.0.0.1:5577`
  - Uses `fetch`
  - Sets JSON request headers automatically when sending a body
  - Parses JSON responses safely, including empty-body cases
  - Throws useful errors with HTTP status code and backend error message when available
  - Validates missing payloads and missing download ids before making requests
  - No UI behavior changed yet; the utility is not wired into the Download button in this milestone

## Milestone 5B Findings: Local Backend Skeleton

- Files created:
  - `local-backend/package.json`
  - `local-backend/server.js`
  - `local-backend/README.md`
- Endpoints implemented:
  - `GET /health`
  - `POST /downloads`
  - `GET /downloads`
  - `GET /downloads/:id`
  - `POST /downloads/:id/pause`
  - `POST /downloads/:id/resume`
  - `POST /downloads/:id/cancel`
  - `DELETE /downloads/:id`
- Current behavior:
  - Binds to `127.0.0.1:5577`
  - Stores download records in memory only
  - Uses documented URL priority `downloadUrl -> streamingUrl -> streamUrl -> externalUrl`
  - Returns `400` when no usable URL is present
  - Does not perform real downloads yet
  - Does not persist data yet
  - Does not launch MPC-HC yet
- How to run:
  - `cd local-backend`
  - `npm install`
  - `npm start`

## Milestone 5A Findings: Backend API Contract

- Added backend API contract document: [CUSTOM_STREMIO_BACKEND_API.md](C:/Users/zuse2/Documents/GitHub/stremio-web/docs/CUSTOM_STREMIO_BACKEND_API.md)
- The contract uses the current `buildDownloadPayload(input)` frontend output as the `POST /downloads` request shape.
- The contract defines:
  - local development base URL `http://127.0.0.1:5577`
  - download record fields and backend-generated fields
  - URL selection priority for backend downloads
  - placeholder control endpoints for download lifecycle and playback
  - Windows-oriented file organization rules
  - local-only security assumptions
- This separates backend contract planning from backend implementation so future agents can build the local service against a stable request/response shape first.

## Milestone 4B Findings: Download Payload Utility

- Files changed:
  - `src/customStremio/downloadPayload.js`
  - `src/routes/MetaDetails/StreamsList/StreamsList.js`
  - `docs/CUSTOM_STREMIO_PROJECT.md`
- New custom utility:
  - `src/customStremio/downloadPayload.js`
  - exports `buildDownloadPayload(input)`
- Why custom code is being isolated:
  - The placeholder download payload shape is custom project logic, not core Stremio behavior.
  - Moving it into a dedicated `customStremio` utility keeps `StreamsList.js` smaller and makes the future backend request mapping easier to evolve in one place.
  - The utility is defensive and normalizes missing fields to `null` instead of relying on UI components to guard every nested property access.
- Current behavior after extraction:
  - The visible `Download` button in each stream item still appears unchanged.
  - Clicking `Download` still logs the same `customStremio.downloadPlaceholder` object shape.
  - Main stream playback/open behavior is unchanged.
  - Preferred-addon sorting and manual addon filtering are unchanged.
- How to test behavior stayed the same:
  - Open a per-video stream page and confirm the `Download` action still appears on stream items.
  - Click the main body of a stream item and confirm playback/open behavior still works.
  - Click `Download` and confirm a `customStremio.downloadPlaceholder` payload still appears in the browser console.
  - Compare the logged fields against Milestone 4A:
    - `metaId`
    - `type`
    - `videoId`
    - `videoTitle`
    - `season`
    - `episode`
    - `videoReleased`
    - `addonName`
    - `streamName`
    - `streamDescription`
    - `streamUrl`
    - `externalUrl`
    - `downloadUrl`
    - `fileName`
    - `streamingUrl`
  - Confirm preferred-addon sorting still works in the `All addons` view.

## Milestone 4A Findings: Placeholder Download Button

- Files changed:
  - `src/routes/MetaDetails/MetaDetails.js`
  - `src/routes/MetaDetails/StreamsList/StreamsList.js`
  - `src/routes/MetaDetails/StreamsList/Stream/Stream.js`
  - `src/routes/MetaDetails/StreamsList/Stream/styles.less`
  - `docs/CUSTOM_STREMIO_PROJECT.md`
- Implementation summary:
  - Added a minimal `metaId` prop pass-through from `MetaDetails.js` into `StreamsList` so the placeholder log can include the selected title id.
  - Added a `console.debug('customStremio.downloadPlaceholder', payload)` placeholder callback in `StreamsList.js`.
  - Added a visible secondary `Download` action inside each rendered stream item in `Stream.js`.
  - The Download action prevents default click behavior and stops propagation so it does not trigger normal stream playback.
  - Existing main stream click/play behavior and existing context-menu copy/open actions are preserved.
- Data logged from the current UI layer:
  - `metaId`
  - `type`
  - `videoId`
  - `videoTitle`
  - `season`
  - `episode`
  - `videoReleased`
  - `addonName`
  - `streamName`
  - `streamDescription`
  - `streamUrl`
  - `externalUrl`
  - `downloadUrl`
  - `fileName`
  - `streamingUrl`
- Missing or limited data:
  - No backend download identifier or backend request schema exists yet.
  - The placeholder log is limited to fields currently visible in the UI/model layer.
  - Some streams may not provide `streamUrl`, `externalUrl`, `downloadUrl`, `fileName`, or `streamingUrl`; these can be `null`.
- How to test:
  - Open a title and navigate to a per-video stream page.
  - Confirm each stream item shows a `Download` action.
  - Click the main stream item and confirm playback/open behavior still works as before.
  - Click `Download` and confirm playback does not start and a structured `console.debug` payload appears.
  - Confirm the payload includes the selected title/video/addon/stream fields listed above.
  - Confirm streams missing download-like URLs still log safely without crashing.
  - Confirm preferred-addon ordering and manual addon filtering still behave as before.

## Milestone 3A Findings: Configurable Preferred Addon Sorting

- Files changed:
  - `src/routes/MetaDetails/StreamsList/StreamsList.js`
  - `docs/CUSTOM_STREMIO_PROJECT.md`
- Local storage key:
  - `customStremio.preferredAddon`
- Implementation summary:
  - Added local `preferredAddon` state in `StreamsList.js`, initialized safely from `localStorage` without assuming `window` exists.
  - Added `normalizeAddonName(value)` to compare addon names case-insensitively and safely.
  - Added `isPreferredAddonStream(stream)` to detect whether a rendered stream belongs to the stored preferred addon.
  - Added a second `MultiselectMenu` control near the existing addon filter UI with the label text shown as `Preferred addon: ...`.
  - Adjusted `src/routes/MetaDetails/StreamsList/styles.less` so the stream-page header row can wrap and give the episode title plus dropdown controls more usable width on long titles.
  - The preferred-addon picker stores the addon display name, not the transport URL.
  - Existing `filteredStreams` logic remains intact; the new `orderedFilteredStreams` step only reorders the already filtered results.
  - Reordering only happens when:
    - the current addon filter is `All addons`
    - a preferred addon is selected
  - Manual addon filtering still uses the existing addon filter and bypasses the preferred ordering step.
- Sorting behavior:
  - Preferred addon streams move to the front.
  - Non-preferred streams remain visible afterward.
  - Relative order is preserved inside both groups.
  - If the preferred addon is not available for the current title or episode, the order stays unchanged.
- How to test:
  - Open a title with multiple stream addons.
  - Open an episode or stream page where `StreamsList` is shown.
  - In the existing addon filter, leave the view on `All addons`.
  - Use the new preferred-addon picker to choose one of the available addon names.
  - Refresh the page and confirm the preferred choice persists.
  - Confirm that streams from the chosen addon appear first in the `All addons` view.
  - Switch the existing addon filter to one specific addon and confirm only that addon’s streams appear, unchanged from prior behavior.
  - Set the preferred addon back to `No preference` and confirm the original order is restored.

## Milestone 3A.1 Findings: Persistent Stream Addon Filter

- The original Stremio addon filter now remembers its last specific-addon selection in browser local storage independently of the custom preferred-addon setting.
- The stored value remains the addon transport URL, matching the existing grouping/filter key without changing addon ordering or stream behavior.
- When the remembered addon is present on a later movie or episode, that addon is selected automatically. When it is absent, the page temporarily displays **All addons** instead of an empty list while retaining the remembered choice for titles where it is available again.
- Selecting **All addons** clears the stored override and restores the original default behavior.
- Storage access is guarded so private/incognito restrictions cannot break the stream page; the current in-memory selection still works.

## Milestone 2 Findings: Stream and Title Data Flow

### 1. Title page to episode/video stream page

- The title page route is the `metadetails` route without a `videoId`, matching `/metadetails/:type/:id`.
- The episode/video stream page is the same `metadetails` route with a `videoId`, matching `/metadetails/:type/:id/:videoId`.
- `useMetaDetails.js` builds the `MetaDetails` model request with:
  - `metaPath` from `urlParams.type` and `urlParams.id`
  - `streamPath` from `urlParams.videoId` when present
- In `Video.js`, clicking a video uses `deepLinks.player` if present, otherwise `deepLinks.metaDetailsStreams`, so the UI navigates from a title-level video entry into the per-video stream page.
- In `MetaDetails.js`, the component switch is controlled by `streamPath !== null`:
  - `streamPath !== null` renders `StreamsList`
  - `streamPath === null` and `metaPath !== null` renders `VideosList`

### 2. Where streams are received in the UI

- The stream list arrives in the UI as `metaDetails.streams` from `useMetaDetails(urlParams)`.
- `MetaDetails.js` passes that value directly into `StreamsList` as the `streams` prop.
- The visible model type in `src/core/types/models/MetaDetails.d.ts` is:
  - `streams: { addon: Addon, content: Loadable<Stream[]> }[]`
- `StreamsList.js` only uses entries where `streams.content.type === 'Ready'`.
- The visible stream fields from `StreamsList.js`, `Stream.js`, and `src/core/types/Stream.d.ts` are:
  - top-level model wrapper:
    - `addon.transportUrl`
    - `addon.manifest.name`
    - `content.type`
    - `content.content` as the actual stream array
  - per stream object:
    - `name`
    - `description`
    - `thumbnail`
    - `progress`
    - `deepLinks.player`
    - `deepLinks.externalPlayer.download`
    - `deepLinks.externalPlayer.magnet`
    - `deepLinks.externalPlayer.streaming`
    - `deepLinks.externalPlayer.playlist`
    - `deepLinks.externalPlayer.fileName`
    - `deepLinks.externalPlayer.web`
    - `deepLinks.externalPlayer.openPlayer.ios`
    - `deepLinks.externalPlayer.openPlayer.android`
    - `deepLinks.externalPlayer.openPlayer.windows`
    - `deepLinks.externalPlayer.openPlayer.macos`
    - `deepLinks.externalPlayer.openPlayer.linux`
    - `ytId`
    - `infoHash`
    - `fileIdx`
    - `url`
    - `externalUrl`
- `StreamsList.js` also adds UI-only derived fields before rendering:
  - `addonName`
  - `onClick`

### 3. Current grouping, filtering, and rendered order

- Grouping by addon happens in `StreamsList.js` inside the `streamsByAddon` `useMemo`.
- The exact grouping logic is the `props.streams.filter(...).reduce(...)` block keyed by `streams.addon.transportUrl`.
- Addon filtering happens in the `filteredStreams` `useMemo`.
  - If `selectedAddon === ALL_ADDONS_KEY`, it returns every addon group.
  - Otherwise it returns only `streamsByAddon[selectedAddon].streams`.
- The final flattened rendered list is also created in `filteredStreams`:
  - `Object.values(streamsByAddon).map(({ streams }) => streams).flat(1)`
- The rendered stream items then come from `filteredStreams.map(...)` in the JSX and are passed into `Stream`.
- There is no explicit stream sort beyond the current object insertion order created while reducing `props.streams`.

### 4. Safest preferred-addon sorting insertion point

- Safest insertion point: `src/routes/MetaDetails/StreamsList/StreamsList.js`, inside or immediately after the `filteredStreams` `useMemo`.
- Safer alternative in the same file: normalize addon order in `streamsByAddon` or create a new `orderedStreams` `useMemo` right before render.
- This is safer than editing core/model code because:
  - the current stream data is already fully available in the UI layer
  - the change is presentation ordering only
  - it avoids changing `useModelState`, the `MetaDetails` model contract, or addon/backend loading behavior
  - it preserves all streams while only reordering them
- Future target behavior should be implemented here as: preferred addon streams first, all remaining streams still shown afterward.

### 5. Watched and unwatched handling

- Movie/title watched state is handled in `MetaDetails.js` by `toggleWatched`, which dispatches:
  - `action: 'MetaDetails'`
  - `args.action: 'MarkAsWatched'`
- Episode watched state is handled in `VideosList.js` by `onMarkVideoAsWatched`, which dispatches:
  - `action: 'MetaDetails'`
  - `args.action: 'MarkVideoAsWatched'`
- Season-level watched state is handled in `VideosList.js` by `onMarkSeasonAsWatched`, which dispatches:
  - `action: 'MetaDetails'`
  - `args.action: 'MarkSeasonAsWatched'`
- `Stream.js` also marks the current video as watched on open when `profile.settings.playerType !== null`, via its own `markVideoAsWatched` callback dispatching `MarkVideoAsWatched`.

### 6. Information available when rendering one stream item

- `Stream.js` receives these props directly:
  - `videoId`
  - `videoReleased`
  - `addonName`
  - `name`
  - `description`
  - `thumbnail`
  - `progress`
  - `deepLinks`
  - `onClick`
- `StreamsList.js` currently passes `video?.id` and `video?.released`, but does not pass meta id, season, episode, or title into `Stream`.
- Data already available in `StreamsList.js` or its parent that would matter later for a Download button:
  - available now in `MetaDetails.js` or `StreamsList.js`:
    - video id: yes
    - video released date: yes
    - video title: yes, via `video.title`
    - season/episode: yes, via `video.season` and `video.episode`
    - addon/source name: yes, via `addon.manifest.name`
    - addon/source transport URL: yes, via `addon.transportUrl`
    - stream playback/download URLs: yes, via `deepLinks.externalPlayer.*` and `deepLinks.player`
  - not currently passed into `Stream.js`:
    - meta id
    - video title
    - season
    - episode
- This means a future Download button could likely be added without touching core, but `Stream.js` would need a few more props from `StreamsList.js` or a higher-level parent.

### 7. Missing or differently named files

- No expected source files were missing.
- One useful detail is naming: the route transition into streams is driven by `video.deepLinks.metaDetailsStreams` inside `src/components/Video/Video.js`, not from `VideosList.js` itself.

## Repo Findings

- `src/routes/MetaDetails/`, `StreamsList/`, `VideosList/`, `src/components/MetaPreview/`, `src/components/MainNavBars/`, `src/App/routerViewsConfig.js`, `src/common/routesRegexp.js`, and `src/routes/Settings/` all exist.
- `MetaDetails.js` switches between:
  - `VideosList` when a meta item is selected without a stream/video route segment
  - `StreamsList` when a `streamPath`/`videoId` is present
- `useMetaDetails.js` is a key data-flow point because it loads both meta and stream context from the model layer.
- `StreamsList.js` is the most likely first insertion point for future preferred-addon sorting/filtering because it already organizes ready streams by addon and determines the rendered stream order.
- `Stream.js` already exposes `deepLinks.externalPlayer.download`, `magnet`, `streaming`, and platform-specific open-player links, which is relevant later for download/MPC-HC planning.
- `VideosList.js` is the title/episode selection layer before stream selection.
- `Settings.tsx` exists as a likely future home for custom user-facing settings if addon preference or download behavior needs configuration.

## Verification

- `docs/CUSTOM_STREMIO_PROJECT.md` exists.
- The file contains all required sections.
- Milestones 1 and 2 are completed.
- Milestone 3 is now in progress through `Milestone 3A`.
- Milestone 4 is now in progress through `Milestone 4A`.

## Assumptions

- No feature implementation is done in this step.
- The tracker should describe current architecture truthfully without overcommitting to backend details.
- `docs/` is expected to be created as a new directory because it is currently missing.
