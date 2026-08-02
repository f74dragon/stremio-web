# Custom Stremio Local Backend

Development-only local backend for the custom Stremio download flow.

It performs real direct HTTP/HTTPS file downloads in the background, persists download records locally, supports pause/resume and retry, updates progress fields over time, and can launch completed local files in an explicitly configured media player.

## Install

```bash
npm install
```

## Start

```bash
npm start
```

## Dev

```bash
npm run dev
```

The server binds to:

`http://127.0.0.1:5577`

## Media Player

Start both the backend and frontend, then open **Downloads -> Download options -> Video player** and choose **Choose player**. A native Windows `.exe` picker opens so you can point directly to MPC-HC or another player. The validated path is stored in `%LOCALAPPDATA%\Custom Stremio\backend-settings.json` and applies immediately without restarting the backend.

The backend does not scan the filesystem or guess installation locations. `CUSTOM_STREMIO_PLAYER_PATH` remains only as a backward-compatible fallback when no saved selection exists:

```powershell
$env:CUSTOM_STREMIO_PLAYER_PATH = 'C:\Program Files\MPC-HC\mpc-hc64.exe'
npm start
```

`POST /play` accepts only a stored `downloadId`; callers cannot submit arbitrary local paths or executable paths for the backend to open.

### MPC-HC Playback Progress

Open **Downloads -> Download options -> MPC-HC playback progress** for setup. In MPC-HC:

1. Open **Options -> Player -> Web Interface** and enable **Listen on port**.
2. Keep the displayed port aligned with Custom Stremio (MPC-HC defaults to `13579`).
3. Enable **Allow access from localhost only**.
4. Under **Player -> History**, enable **Keep history** and **Remember File position**.

Use **Test connection**, then enable and save progress tracking. The backend connects only to `127.0.0.1`, reads playback state without controlling the player, and accepts progress only when MPC-HC reports the exact file launched from a completed download record. MPC-HC remains responsible for actual resume behavior.

Verified observations are stored atomically in `%LOCALAPPDATA%\Custom Stremio\playback-progress.json`. Tracking is optional: playback continues normally if it is disabled or MPC-HC telemetry is unavailable. Full local paths are not returned by the progress API.

## Download Folder

Default root:

`%USERPROFILE%\Downloads\Stremio Downloads`

Override it with:

```powershell
$env:CUSTOM_STREMIO_DOWNLOAD_DIR = 'C:\Temp\Custom Stremio Downloads'
npm start
```

## Download Concurrency

The scheduler starts downloads in FIFO order and runs at most two transfers simultaneously by default. The normal user control is available under **Downloads → Download options → Simultaneous downloads** and applies without restarting the backend.

The saved value is stored in:

`%LOCALAPPDATA%\Custom Stremio\backend-settings.json`

`CUSTOM_STREMIO_DATA_DIR` also relocates this settings file. The environment variable remains an optional initial fallback when no saved selection exists yet:

```powershell
$env:CUSTOM_STREMIO_MAX_CONCURRENT_DOWNLOADS = '1'
npm start
```

Accepted backend values are positive whole numbers or `unlimited`. The app presents quick choices `1` through `4`, a Custom number field, and an explicit Unlimited mode. Missing or invalid environment values use the default of `2`. Once an in-app choice is saved, it takes precedence over the environment fallback.

Unlimited starts every queued transfer and can use substantial bandwidth, storage I/O, and system resources. Custom values and Unlimited are applied immediately without interrupting transfers that are already active.

## AllDebrid Account and Safe Source Readiness

Open **Downloads -> Download options -> AllDebrid availability** and choose **Connect AllDebrid**. The backend displays an official PIN and the app provides a direct link to AllDebrid's authorization page. No API key needs to be copied into an environment variable or frontend setting.

The API key is stored only in the local backend settings file:

`%LOCALAPPDATA%\Custom Stremio\backend-settings.json`

Frontend API responses expose only connection, username, and premium state. They never return the key. Treat the local data directory as private because an AllDebrid API key grants account access.

Debrid routes accept browser requests only from the local development origins on port `8080` by default. If this fork is served from another trusted origin, add a comma-separated allowlist before starting the backend:

```powershell
$env:CUSTOM_STREMIO_ALLOWED_ORIGINS = 'https://my-trusted-local-origin.example'
```

Normal stream browsing:

- reads persistent local history and recognizes Torrentio `[AD+]` as a positive fallback hint;
- treats `[AD Download]` as unknown unless an explicit provider observation exists;
- performs no AllDebrid API request and creates no magnet while browsing, filtering, or sorting;
- offers a disclosed **Check availability** action when the account is connected and visible sources contain hashes;
- never replace or unlock the Stremio URL used by the downloader;
- rejects known Torrentio `downloading.mp4` / `downloading_vN.mp4` redirect placeholders before requesting their body or finalizing a file.

The backend retains an explicit `POST /debrid/alldebrid/availability` capability for future opt-in actions. It:

- uses torrent `infoHash` values supplied by the caller;
- reports the upload response's `ready` state;
- protects every magnet that existed in the account before the check;
- immediately deletes every newly created ready or not-ready check magnet;
- retains failed cleanup IDs in `alldebrid-pending-cleanup.json` and retries them after restart;
- caches repeat checks for five minutes to reduce repeated provider mutations;
- stores cached observations for 30 days and not-cached observations for 15 minutes in `alldebrid-availability-history.json`.

AllDebrid's documented API does not expose a read-only instant-availability endpoint. The explicit action therefore uses the documented upload response, which means an uncached torrent may briefly begin provider-side peer processing before the temporary magnet is deleted. It is never called automatically. When an unchecked Torrentio download resolves to the known placeholder, the backend matches the URL hash against account magnets and deletes only newly created exact-hash IDs; preexisting and unrelated magnets are protected. Disconnect is blocked while cleanup remains pending so the backend does not discard the credential needed to finish cleanup.

## Real-Debrid Account and Explicit Availability

Open **Downloads -> Download options -> Real-Debrid account** and choose **Connect Real-Debrid**. The app shows a device code and opens the official authorization page. After approval, account-bound OAuth client credentials and access/refresh tokens are stored only in:

`%LOCALAPPDATA%\Custom Stremio\backend-settings.json`

Frontend responses expose only sanitized account and premium state. Access tokens refresh locally when needed, and Disconnect revokes the active token before removing the saved connection. Treat the local data directory as private.

Opening and filtering stream sources reads only persistent local availability history. It does not contact Real-Debrid. When the user explicitly chooses **Check Real-Debrid**, the backend uses the documented add/select/info/delete workflow and clearly discloses that temporary account torrents are created.

The check is source-file-specific: it combines hash, Stremio file index, filename, and video size, then selects only a uniquely matched requested file. Only `downloaded`/100% is cached. A queued/non-downloaded result is not instant, ambiguous files remain unknown without selection, and HTTP `451` is unavailable. Current and historical results appear as provider-specific stream badges and govern only the matching provider row; they never replace its original Stremio download URL.

Provider-specific download safety is enforced in both layers. The frontend disables AllDebrid or Real-Debrid rows known not cached/unavailable, while `POST /downloads` re-reads the matching persistent provider history before creating a record. A valid row on the other provider remains usable. Unknown and unchecked rows retain their prior behavior, with the known Torrentio placeholder redirect detector as a final guard.

Real-Debrid rows are recognized from `[RD]`, `[RD+]`, `[RD Download]`, explicit RealDebrid addon metadata, and resolver/deep-link URLs containing `realdebrid`. These labels identify the provider but do not count as verified cache results. Episode resolver hashes are extracted from all external-player link variants, including percent-encoded URLs. Both provider controls remain present for populated stream lists even while the backend is offline: disconnected providers, absent filtered sources, and rows without a checkable hash receive explicit disabled states instead of making the feature disappear.

The final download guard rejects Torrentio `downloading_vN.mp4` and `failed_*_vN.mp4` videos before requesting or writing their bodies. This includes `failed_infringement_v2.mp4`. Direct HTTP `451` responses fail as `SOURCE_UNAVAILABLE`. Failed provider resolver downloads immediately replace stale positive history: preparing placeholders become not cached and other failures become unavailable. A later successful download or explicit positive check restores cached status. A generic minimum-size rule is not used because legitimate short videos can be small.

Large addon result sets are batched by the frontend for passive history reads: 100 AllDebrid hashes or 50 Real-Debrid source descriptors per backend request. User-triggered explicit checks use one item per request so each visible row and the completed/total counter update live. Route/provider HTTP errors are shown as their actual error and preserve the known connection state; only a network failure marks the backend unavailable.

After every non-positive exact-file Real-Debrid result, the frontend automatically runs a separate HEAD-only resolver fallback for that row. This lets a valid resolver link correct a false-negative uncached/unavailable file match. It follows at most five redirects, uses five-second request timeouts, never reads or writes a response body, and does not use a ranged GET. Known preparing/failed placeholders and HTTP `451` remain negative; credible media headers produce **Ready to download** rather than a cached-provider claim. Ready observations last only five minutes, while unsupported HEAD responses and network ambiguity remain unknown. Exact-hash account entries are snapshotted before the probe and only newly created IDs are journaled and cleaned afterward.

Every new torrent ID is saved to `%LOCALAPPDATA%\Custom Stremio\realdebrid-pending-cleanup.json` before selection, deleted in that source check's `finally`, and verified absent before the frontend advances to the next source. Existing same-hash account IDs are protected. Failed cleanup is retried after restart, and disconnect is blocked while cleanup remains pending. Results persist separately in `realdebrid-availability-history.json`; cached results last 30 days, resolver-ready results five minutes, not-cached results 15 minutes, and unavailable results 24 hours.

Authenticated testing confirmed the historical instant-availability route returns provider error code `37`, `disabled_endpoint`. The disabled diagnostic endpoint and client method were removed; production behavior uses only documented endpoints.

A controlled add/select/info/delete test confirmed the documented workflow: adding produced `waiting_files_selection` without peer activity; selecting the largest video file changed a cached candidate to `downloaded`/100% in under one second; deleting the exact returned ID succeeded with HTTP `204` and restored the original account count. This proves positive cached detection, but does not yet establish the safest observation window for an uncached selection.

Five hashes previously recorded as uncached by AllDebrid were also tested against Real-Debrid. Two were instantly cached by Real-Debrid after selection and three were rejected with HTTP `451` before an account ID was created. No candidate entered peer downloading. This confirms provider results are not interchangeable and that rejected additions require no cleanup, while every successfully created temporary ID must still be deleted and verified independently.

A later user-supplied uncached hash completed the negative-path test. It moved from `waiting_files_selection` to `queued`/0% at 363 ms after selection rather than `downloaded`/100%. The exact ID was deleted and verified in roughly 1.2 seconds total, before any measured progress or transfer speed; the complete account torrent list was unchanged afterward. The implemented check therefore accepts only `downloaded`/100% as cached and cleans up every other post-selection state.

## Persistent Download Records

Download metadata is stored separately from media files at:

`%LOCALAPPDATA%\Custom Stremio\download-records.json`

On systems without `LOCALAPPDATA`, the fallback is `~/.custom-stremio/download-records.json`.

Override the metadata directory with:

```powershell
$env:CUSTOM_STREMIO_DATA_DIR = 'C:\Temp\Custom Stremio Data'
npm start
```

The backend writes a versioned JSON document through an atomic temporary-file replacement. Rapid progress updates are coalesced to avoid rewriting the file for every network chunk.

Restart behavior:

- Completed, failed, and canceled records are restored.
- Restored completed records remain playable when their media file still exists.
- Waiting `queued` records remain queued and automatically re-enter the scheduler in FIFO order.
- Records that were actively `downloading` are restored as `paused` with an interruption note. Existing paused records remain paused and can be resumed explicitly.
- Removed records stay removed. Removing a record does not delete its media file.
- If the metadata document is malformed or uses an unsupported version, startup stops instead of silently overwriting the stored data.

## Current Download Behavior

- `POST /downloads` returns immediately with a queued record. The FIFO scheduler starts it when a concurrency slot is available.
- Records update in memory and are persisted as the download moves through `queued`, `downloading`, `paused`, `completed`, `failed`, or `canceled`.
- New downloads, retries, and resumes use the same queue. Retry and Resume enter at the back with a refreshed `queuedAt` timestamp.
- `GET /downloads` and `GET /downloads/:id` decorate waiting records with live one-based `queuePosition` and `queueLength` values. They also derive `sharedDestinationCount` and the stricter `sharedPartialOwnerCount` used for safe duplicate cleanup. These response-only fields are never persisted.
- `PATCH /downloads/:id/queue` with `{ "position": 1 }` moves a waiting record and persists the resulting order across backend restarts. Active and non-queued records cannot be reordered.
- Finishing, failing, pausing, or canceling an active transfer releases its scheduler slot for the next waiting job.
- Duplicate prevention still applies before a new download starts.
- Only `http` and `https` source URLs are accepted.

## Cancel / Retry / Pause / Resume

- `POST /downloads/:id/cancel` removes waiting work before it starts or stops an active download and marks the record `canceled`.
- `POST /downloads/:id/pause` removes waiting work from the queue or stops an active transfer, preserves its `.part` file, and marks the record `paused`.
- `POST /downloads/:id/resume` measures the trusted `.part` file and requests the remaining bytes with HTTP Range semantics.
- Non-zero resumes require a matching `206 Partial Content` response. When a strong `ETag` or `Last-Modified` value is available, the backend also sends `If-Range` to protect against joining bytes from a changed source file.
- If a server ignores the Range request, the record becomes `failed` without appending a full response to the partial file. Use Retry to restart safely from byte zero.
- `POST /downloads/:id/retry` resets an inactive `failed` or `canceled` record and starts it again from byte zero.
- Retry reuses the same record id, preserves its media metadata, increments `attemptCount`, and persists `queued` before restarting the background transfer.
- Retry derives the destination from stored record metadata, removes only a verified record-owned `.part` file, and never removes or overwrites an existing final file; callers cannot supply a filesystem path.
- Partial files may remain after pause, cancel, or failure until the record is resumed, retried, or explicitly deleted from the Downloads UI.

## Remove Record / Delete Local Media

- `DELETE /downloads/:id` removes inactive persistent metadata only and deliberately leaves final data on disk. It rejects queued, downloading, and paused records, plus failed/canceled records that would become the last abandoned claim on partial data. A duplicate partial record is removable only when another record claims the same path and persisted identity.
- `DELETE /downloads/:id/media` is the destructive action for `paused`, `completed`, `failed`, and `canceled` records. Completed records may delete only their verified final file; other states may delete only their verified `.part` file.
- Bulk deletion in the Downloads UI intentionally sequences these existing per-record routes. There is no broad backend batch-delete or arbitrary-path API, so every selected record still passes the same ownership, path-containment, identity, sharing, and lifecycle checks.
- The destructive endpoint accepts only a download id. A candidate must have been recorded on that download, match the freshly derived path, remain inside the configured root after real-path resolution, be a regular non-symbolic-link file, and retain the same persisted file identity.
- Legacy or replaced files without a matching identity are refused rather than guessed. If such a file is already missing, the stale record can still be cleared safely.
- Deletion is blocked when another saved record resolves to the same local path and the artifact exists. Remove identity-matched duplicate records first so shared media cannot be deleted accidentally. If the artifact is already missing, stale records can be deleted directly and do not deadlock one another.
- Per-record and destination locks prevent deletion from racing Resume, Retry, Cancel, or creation of a new same-path download.
- Only empty title/season directories are cleaned up; the download root, unrelated files, and nonempty folders are retained.
- Windows file-lock or filesystem failures leave the record available for another attempt. A missing artifact is treated as already deleted.
- Pause intentionally keeps `.part` bytes for Resume. Use **Delete partial data** when those bytes should be permanently discarded instead.
- New transfers use exclusive `.part` creation and finalization refuses an existing destination, so unrelated same-named files are never truncated or overwritten.

## Permanent Download History

- Lifecycle events are appended to `%LOCALAPPDATA%\Custom Stremio\download-history.ndjson`, or the directory selected by `CUSTOM_STREMIO_DATA_DIR`.
- `GET /downloads/history` returns newest events first and accepts an optional positive `limit` capped at `1000`.
- History survives active-record removal, local-media deletion, and backend restarts. Existing records are backfilled once after upgrading.
- Destructive record/media deletion is refused if its permanent pre-deletion history event cannot be written.
- Only allowlisted display metadata is retained. Source/download URLs, full local paths, credentials, tokens, response validators, and free-form errors are excluded.
- Corrupt or truncated individual lines are reported and ignored without discarding surrounding valid events. There is intentionally no history deletion endpoint.

## PowerShell Test: Health

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:5577/health'
```

The response includes `downloads.maxConcurrent`, `downloads.active`, and `downloads.queued` scheduler diagnostics.

## PowerShell Test: Download Settings

Read the active setting:

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:5577/settings'
```

Update it without restarting:

```powershell
$settings = @{ downloads = @{ maxConcurrentDownloads = 2 } } | ConvertTo-Json
Invoke-RestMethod -Uri 'http://127.0.0.1:5577/settings' -Method Patch -ContentType 'application/json' -Body $settings
```

Increasing the value starts additional queued work immediately. Decreasing it lets active transfers continue and applies the lower cap as slots become free.

## PowerShell Test: Create Direct Download

Replace `downloadUrl` with a real direct video URL.

```powershell
$payload = @{
  metaId = 'tt1234567'
  type = 'movie'
  parentTitle = 'Test Movie'
  poster = 'https://images.example/test-movie-poster.jpg'
  background = 'https://images.example/test-movie-background.jpg'
  logo = 'https://images.example/test-movie-logo.png'
  description = 'Test movie summary.'
  runtime = '112 min'
  releaseInfo = '2026'
  titleReleased = '2026-01-01T00:00:00.000Z'
  metaLinks = @(
    @{ category = 'Genres'; name = 'Drama'; url = 'stremio:///discover/drama' }
    @{ category = 'imdb'; name = '8.1'; url = 'https://imdb.com/title/tt1234567' }
  )
  videoId = $null
  videoTitle = 'Test Movie'
  videoThumbnail = 'https://images.example/test-movie-thumbnail.jpg'
  season = $null
  episode = $null
  videoReleased = '2024-03-01T00:00:00.000Z'
  addonName = 'Direct URL'
  streamName = '1080p'
  streamDescription = 'Direct file test'
  streamUrl = $null
  externalUrl = $null
  downloadUrl = 'http://127.0.0.1:8090/video.mp4'
  fileName = 'Test.Movie.mp4'
  streamingUrl = $null
} | ConvertTo-Json

$created = Invoke-RestMethod -Uri 'http://127.0.0.1:5577/downloads' -Method Post -ContentType 'application/json' -Body $payload
$created | ConvertTo-Json -Depth 8
```

## PowerShell Test: Poll Progress

Replace the id with the created record id if needed.

```powershell
1..10 | ForEach-Object {
  Invoke-RestMethod -Uri ("http://127.0.0.1:5577/downloads/{0}" -f $created.id) | ConvertTo-Json -Depth 8
  Start-Sleep -Milliseconds 700
}
```

## PowerShell Test: Duplicate Prevention

Run the same request twice while the first record is still active:

```powershell
$first = Invoke-RestMethod -Uri 'http://127.0.0.1:5577/downloads' -Method Post -ContentType 'application/json' -Body $payload
$second = Invoke-RestMethod -Uri 'http://127.0.0.1:5577/downloads' -Method Post -ContentType 'application/json' -Body $payload

$first | ConvertTo-Json -Depth 8
$second | ConvertTo-Json -Depth 8
```

Expected:

- first response: `duplicate: false`
- second response: `duplicate: true`

## PowerShell Test: Cancel Active Download

```powershell
Invoke-RestMethod -Uri ("http://127.0.0.1:5577/downloads/{0}/cancel" -f $created.id) -Method Post | ConvertTo-Json -Depth 8
```

## PowerShell Test: Pause and Resume

Pause while a sufficiently large download is active, then resume the same record:

```powershell
$paused = Invoke-RestMethod -Uri ("http://127.0.0.1:5577/downloads/{0}/pause" -f $created.id) -Method Post
$paused | ConvertTo-Json -Depth 8

$resumed = Invoke-RestMethod -Uri ("http://127.0.0.1:5577/downloads/{0}/resume" -f $created.id) -Method Post
$resumed | ConvertTo-Json -Depth 8
```

Expected:

- Pause returns `status: paused` and retains a `.part` path.
- Resume returns `status: queued`, then progresses through `downloading` to `completed` when the source supports byte ranges.
- A backend restart during an active transfer restores the record as `paused`; resuming is a deliberate user action.

## PowerShell Test: Retry a Failed or Canceled Download

```powershell
Invoke-RestMethod -Uri ("http://127.0.0.1:5577/downloads/{0}/retry" -f $created.id) -Method Post | ConvertTo-Json -Depth 8
```

## PowerShell Test: Play Completed Download

After `$created` reaches `completed`:

```powershell
$playPayload = @{
  downloadId = $created.id
} | ConvertTo-Json

Invoke-RestMethod -Uri 'http://127.0.0.1:5577/play' -Method Post -ContentType 'application/json' -Body $playPayload | ConvertTo-Json -Depth 8
```

## PowerShell Test: Open Download Location

```powershell
Invoke-RestMethod -Uri ("http://127.0.0.1:5577/downloads/{0}/open-location" -f $created.id) -Method Post | ConvertTo-Json -Depth 8
```

## PowerShell Test: Unsupported Protocol

```powershell
$badPayload = @{
  metaId = 'ttbad'
  type = 'movie'
  videoId = $null
  videoTitle = 'Bad Protocol'
  downloadUrl = 'ftp://example.com/file.mp4'
} | ConvertTo-Json

Invoke-RestMethod -Uri 'http://127.0.0.1:5577/downloads' -Method Post -ContentType 'application/json' -Body $badPayload
```

## Notes

- Download records persist across backend restarts.
- Failed and canceled records can be retried from the frontend or through `POST /downloads/:id/retry`; completed and active records cannot be retried.
- New records preserve optional title posters/backgrounds, logos, summaries, runtime/release information, metadata links, and episode thumbnails for the media-first Downloads Library. Older records without rich metadata remain valid and use frontend fallbacks.
- Torrent-backed records also preserve `infoHash`, `fileIdx`, and safe filename/video-size behavior hints for availability and later source-selection work. These fields do not change the selected direct download URL.
- `POST /downloads/:id/open-location` opens only locations derived from stored records; it does not accept caller-supplied paths.
- The first restart after upgrading from the older in-memory backend cannot recover records that were never written by that older process; their media files remain on disk.
- Waiting queued work is restored in saved manual order when present and FIFO order otherwise; interrupted active transfers are restored as `paused` and can be resumed explicitly.
- Real file downloading is implemented only for direct `http`/`https` URLs in this milestone.
- Pause/resume requires the remote direct-file source to honor HTTP byte ranges. Unsupported sources fail safely and can still use Retry from byte zero.
- Completed records can be opened through `POST /play` when Download options contains a valid saved player executable. The legacy environment fallback is still accepted when no saved path exists.
