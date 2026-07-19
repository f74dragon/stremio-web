# Custom Stremio Local Backend API Contract

## Purpose

The local backend will run on the user’s machine and handle:

- direct video file downloads from resolved Stremio/RealDebrid stream URLs
- progress tracking
- pause/resume/retry/cancel/delete
- organized file paths
- launching MPC-HC for completed downloads
- later watched/progress integration

## Development Base URL

`http://127.0.0.1:5577`

This is the development base URL. Final packaging may hide this behind IPC, a bundled service, or an internal local process.

## Data Model: Download Request

The frontend will send `POST /downloads` using the current `buildDownloadPayload(input)` output shape:

- `metaId`
- `type`
- `parentTitle`
- `poster`
- `background`
- `logo`
- `description`
- `runtime`
- `releaseInfo`
- `titleReleased`
- `metaLinks`
- `videoId`
- `videoTitle`
- `videoThumbnail`
- `season`
- `episode`
- `videoReleased`
- `addonName`
- `debridProvider` (`alldebrid`, `realdebrid`, or `unknown`)
- `streamName`
- `streamDescription`
- `sourceReadiness` (`cached`, `previously_cached`, `requires_caching`, `unavailable`, or `unknown`)
- `infoHash` (normalized 40-character torrent hash when provided by the Stremio stream)
- `fileIdx`
- `behaviorHints` (`filename` and `videoSize` only)
- `streamUrl`
- `externalUrl`
- `downloadUrl`
- `fileName`
- `streamingUrl`

The backend will generate and maintain these backend-only fields later:

- `id`
- `status`
- `localPath`
- `partialPath`
- `bytesDownloaded`
- `bytesTotal`
- `progress`
- `speedBytesPerSecond`
- `etaSeconds`
- `queuedAt`
- `queueOrder` (optional persisted manual ordering; normally `null`)
- `queuePosition` (runtime-only for `queued` records; `1` is next to start)
- `queueLength` (runtime-only total waiting count)
- `createdAt`
- `updatedAt`
- `completedAt`
- `error`
- `attemptCount`
- `lastAttemptAt`
- `resumeSupported`
- `sourceEtag`
- `sourceLastModified`

Example combined download record shape:

```json
{
  "id": "dl_0001",
  "metaId": "tt1234567",
  "type": "series",
  "parentTitle": "Show Title",
  "poster": "https://images.example/show-poster.jpg",
  "background": "https://images.example/show-background.jpg",
  "logo": "https://images.example/show-logo.png",
  "description": "Series summary.",
  "runtime": "52 min",
  "releaseInfo": "2024-",
  "titleReleased": "2024-01-01T00:00:00.000Z",
  "metaLinks": [
    { "category": "Genres", "name": "Drama", "url": "stremio:///discover/drama" },
    { "category": "imdb", "name": "8.4", "url": "https://imdb.com/title/tt1234567" }
  ],
  "videoId": "tt1234567:1:2",
  "videoTitle": "Episode Title",
  "videoThumbnail": "https://images.example/episode-thumbnail.jpg",
  "season": 1,
  "episode": 2,
  "videoReleased": "2024-03-01T00:00:00.000Z",
  "addonName": "Torrentio",
  "debridProvider": "realdebrid",
  "streamName": "1080p BluRay",
  "streamDescription": "English, x264",
  "sourceReadiness": "cached",
  "infoHash": "842783e3005495d5d1637f5364b59343c7844707",
  "fileIdx": 3,
  "behaviorHints": {
    "filename": "Episode.Title.S01E02.mkv",
    "videoSize": 1234567890
  },
  "streamUrl": null,
  "externalUrl": null,
  "downloadUrl": "https://example.com/file.torrent",
  "fileName": "Episode.Title.S01E02.mkv",
  "streamingUrl": "http://127.0.0.1:11470/stream/...",
  "status": "queued",
  "localPath": null,
  "partialPath": null,
  "bytesDownloaded": 0,
  "bytesTotal": null,
  "progress": 0,
  "speedBytesPerSecond": 0,
  "etaSeconds": null,
  "queuedAt": "2026-05-23T12:00:00.000Z",
  "queueOrder": null,
  "queuePosition": 1,
  "queueLength": 3,
  "createdAt": "2026-05-23T12:00:00.000Z",
  "updatedAt": "2026-05-23T12:00:00.000Z",
  "completedAt": null,
  "error": null,
  "attemptCount": 1,
  "lastAttemptAt": "2026-05-23T12:00:00.000Z",
  "resumeSupported": null,
  "sourceEtag": null,
  "sourceLastModified": null,
  "duplicate": false
}
```

## Important URL Selection Rule

- Backend should prefer `downloadUrl` if present.
- Else use `streamingUrl`.
- Else use `streamUrl`.
- Else use `externalUrl`.
- If none exist, reject the request with an error.

## Endpoint Contract

### 1. `GET /health`

Purpose:
- Simple process health check for frontend startup or local diagnostics.

Response shape:

```json
{
  "ok": true,
  "service": "custom-stremio-local-backend",
  "version": "dev",
  "time": "2026-05-23T12:00:00.000Z",
  "downloads": {
    "maxConcurrent": 2,
    "active": 1,
    "queued": 3
  }
}
```

### 1A. `GET /settings`

Purpose:
- Read local backend settings used by the custom Stremio UI.

Response shape:

```json
{
  "downloads": {
    "maxConcurrentDownloads": 2,
    "minAllowedConcurrentDownloads": 1,
    "maxAllowedConcurrentDownloads": null,
    "unlimitedValue": "unlimited"
  },
  "debrid": {
    "allDebrid": { "connected": true },
    "realDebrid": { "connected": false }
  }
}
```

### 1B. `PATCH /settings`

Purpose:
- Persist and immediately apply a local download concurrency limit.

Request shape:

```json
{
  "downloads": {
    "maxConcurrentDownloads": 2
  }
}
```

Behavior notes:
- Accepted values are positive safe integers or the string `"unlimited"`; invalid values return HTTP `400`.
- Positive integers provide an exact custom concurrency limit. `"unlimited"` immediately dispatches every queued transfer without a concurrency cap.
- The new value is atomically persisted before it is applied to the live scheduler. Persistence failures return HTTP `500` and leave the previous runtime value active.
- Raising the limit immediately starts additional FIFO work when available.
- Lowering the limit does not interrupt active transfers. New work waits until the active count is below the new value.
- The response uses the same shape as `GET /settings`.

### AllDebrid authentication and availability

#### `POST /debrid/alldebrid/auth/pin`

- Starts the official AllDebrid PIN flow through `GET https://api.alldebrid.com/v4.1/pin/get`.
- Returns only `pin`, `userUrl`, and `expiresAt`; the provider check token stays in backend memory.
- The user opens `userUrl` and authorizes the displayed PIN.

#### `POST /debrid/alldebrid/auth/pin/check`

- Checks the active PIN through `POST https://api.alldebrid.com/v4/pin/check`.
- Before activation, returns `{ "activated": false, "expiresAt": "..." }`.
- After activation, validates the returned API key with `/v4/user`, stores it in local backend settings, and returns sanitized connection state. The API key is never returned to frontend code.
- Browser calls to `/debrid/*` accept trusted local port-8080 origins by default. Additional exact origins require `CUSTOM_STREMIO_ALLOWED_ORIGINS`; requests without an `Origin` header remain available for local command-line diagnostics.

#### `DELETE /debrid/alldebrid/auth`

- Disconnects the locally stored AllDebrid account and clears only the short-lived in-memory repeat-check cache. Persistent availability history is retained.
- Pending temporary-magnet cleanup is retried before the key is removed. Disconnect returns HTTP `409` rather than discarding the only credential capable of cleanup when items still remain.

#### `POST /debrid/alldebrid/availability`

This is an explicit, account-mutating diagnostic capability. The stream browser does not call it automatically. Normal browsing treats `[AD+]` as a positive addon-provided signal, but does not treat `[AD Download]` as a negative result because live testing proved that label can still resolve to a real cached file.

Request:

```json
{
  "hashes": ["842783e3005495d5d1637f5364b59343c7844707"]
}
```

Response:

```json
{
  "provider": "alldebrid",
  "connected": true,
  "items": [
    {
      "hash": "842783e3005495d5d1637f5364b59343c7844707",
      "status": "cached",
      "checkedAt": "2026-07-17T12:00:00.000Z",
      "fromCache": false
    }
  ],
  "pendingCleanup": 0,
  "cleanupWarning": null
}
```

Behavior and safety:

- Accepts at most 100 unique, valid 40-character hexadecimal info hashes per request.
- Uses the documented `POST /v4/magnet/upload` response `ready` field. The removed undocumented `/magnet/instant` endpoint is not used.
- Snapshots existing magnet IDs first, journals every new ID, deletes all check-created ready and not-ready magnets, and verifies cleanup through a fresh status snapshot.
- Existing account magnets are protected and never deleted by a check.
- Failed cleanup remains in `%LOCALAPPDATA%\Custom Stremio\alldebrid-pending-cleanup.json` and is retried on the next check and backend startup.
- Explicit cached and uncached results live in backend memory for five minutes to reduce account mutations and API traffic. A later failed download clears the matching memory entry so an explicit recheck is live.
- `fromCache` reports whether that item came from this five-minute backend cache; provider availability is represented only by `status`.
- Confirmed `cached`, `uncached`, and failed-download `unavailable` observations are written to persistent availability history with their longer display TTLs.
- Because AllDebrid has no documented read-only cache endpoint, uploading an uncached hash may briefly start peer processing before immediate deletion.
- Do not use this endpoint for passive page-load checks. The stream page calls it only from the explicit, disclosed **Check availability** action.
- This endpoint only supplies UI availability metadata. `POST /downloads` continues to use the original Stremio-provided URL.
- The frontend splits larger explicit checks and history reads into requests of at most 100 hashes, preserving the route limit without treating an HTTP validation response as an offline backend.

#### `POST /debrid/alldebrid/availability/history`

Read-only local history lookup. It never calls AllDebrid and is safe for the stream page to call while browsing.

Request:

```json
{ "hashes": ["842783e3005495d5d1637f5364b59343c7844707"] }
```

Each response item contains `hash`, `status`, `verifiedAt`, `expiresAt`, `source`, and `previouslyVerified`. Missing and expired entries return `status: "unknown"`. Cached observations expire after 30 days and history-loaded positives set `previouslyVerified: true`; uncached observations expire after 15 minutes and unavailable observations after 24 hours. Later definitive download/check evidence replaces an older result for the same hash.

### Real-Debrid authentication and explicit source availability

#### `POST /debrid/realdebrid/auth/device`

- Starts Real-Debrid's documented open-source device authorization with the public client ID and `new_credentials=yes`.
- Returns `userCode`, `verificationUrl`, `expiresAt`, and `intervalSeconds`. The device code remains in backend memory.

#### `POST /debrid/realdebrid/auth/device/check`

- Polls the documented device-credentials endpoint. Before approval it returns `{ "activated": false }`.
- After approval, exchanges the device code for access/refresh tokens, reads `/user`, stores account-bound credentials in backend settings, and returns only sanitized connection/profile state.
- Access tokens are refreshed in the backend when within 60 seconds of expiration. Concurrent consumers share one refresh operation.

#### `DELETE /debrid/realdebrid/auth`

- Retries pending temporary-torrent cleanup first. Disconnect returns HTTP `409` while any cleanup ID remains pending so the backend retains the credential needed to finish safely.
- After cleanup, calls the documented `GET /disable_access_token` endpoint and removes local Real-Debrid credentials after successful revocation.

#### `POST /debrid/realdebrid/availability`

Explicit account-mutating availability check. It is called only when the user chooses **Check Real-Debrid**; opening or filtering a title never calls it.

The frontend sends explicit checks one source per request so it can render live row-level and completed/total progress. Within each request, deletion and absence verification of the newly created temporary torrent complete before the response returns; cleanup is never intentionally postponed until the end of the visible title scan.

```json
{
  "sources": [
    {
      "hash": "842783e3005495d5d1637f5364b59343c7844707",
      "fileIdx": 3,
      "filename": "Show.Name.S01E04.1080p.mkv",
      "videoSize": 2147483648
    }
  ]
}
```

- Accepts at most 50 source descriptors and deduplicates their exact source keys. A valid 40-character hexadecimal `hash` is required; `fileIdx`, `filename`, and `videoSize` are optional matching evidence.
- For each source, snapshots preexisting exact-hash torrent IDs, adds one temporary magnet, waits for its file metadata, and selects only a uniquely matched requested file. Ambiguous multi-file matches return `status: "unknown"` without selecting a file.
- Only provider status `downloaded` with `progress: 100` returns `status: "cached"`. A persistent non-downloaded state or observed peer activity returns `status: "uncached"`. HTTP `451` / provider code `35` returns `status: "unavailable"` without cleanup when no ID was created.
- Every newly returned ID is durably journaled before selection, deleted in `finally`, and verified absent. Existing same-hash IDs are protected. Lost add responses trigger exact-hash reconciliation against the pre-request snapshot.
- Returns `items`, `pendingCleanup`, and an optional `cleanupWarning`. Per-source matching/provider failures are returned as `unknown`, `invalid`, or `error` items rather than changing another source's result.
- Repeat checks have a five-minute in-memory result cache. Persistent source-file observations use separate longer TTLs described below.
- This endpoint reports availability only. It never changes or replaces the Stremio URL used by `POST /downloads`.
- The frontend splits larger explicit checks and history reads into requests of at most 50 exact source descriptors, preserving the route limit without treating an HTTP validation response as an offline backend.

#### `POST /debrid/realdebrid/availability/history`

Local-only history lookup. It accepts the same `sources` array, makes no Real-Debrid API request, and is safe to call while browsing.

- Returns `cached`, `uncached`, `unavailable`, `unknown`, or `invalid` for each exact source key.
- Cached observations expire after 30 days and history-loaded positives return `previouslyVerified: true`. Uncached observations expire after 15 minutes; unavailable observations expire after 24 hours.
- Later definitive download/check evidence replaces an older observation for the same exact source file. Failed-download observations clear the short in-memory check cache so an explicit recheck contacts the provider.
- Authenticated testing proved the historical `GET /torrents/instantAvailability/{hash}` route returns provider error code `37`, `disabled_endpoint`; that diagnostic route and client method are intentionally absent.

### 2. `POST /downloads`

Purpose:
- Create a new local download job from the frontend payload.
- Reject payloads already identified as `requires_caching` or `unavailable`, plus direct known Torrentio placeholder URLs, with HTTP `409`. Preparing sources use `SOURCE_NOT_READY`; provider-rejected sources use `SOURCE_UNAVAILABLE`.

Request body:
- The frontend `buildDownloadPayload(input)` output fields listed above.
- `debridProvider` identifies which provider owns the submitted source URL. Conservative addon/stream metadata detection supplies `alldebrid`, `realdebrid`, or `unknown`.
- `sourceReadiness` is provider-scoped and is one of `cached`, `previously_cached`, `requires_caching`, `unavailable`, or `unknown`. Persistent provider observations override addon label hints; an unchecked download-route label remains `unknown` and usable.
- Before accepting a job, the backend also reads persistent history for the identified provider. AllDebrid uses the hash record; Real-Debrid uses the exact hash/file-index/filename/size key. A stored `uncached` or `unavailable` result is rejected even if the request claims `unknown`.
- Provider results are not interchangeable: a failed Real-Debrid URL remains blocked even when an AllDebrid row for the same media is cached, and vice versa. The valid provider's own row remains downloadable.
- Redirect inspection rejects both Torrentio `downloading_vN.mp4` and `failed_*_vN.mp4` families before requesting their bodies. The observed infringement placeholder is `https://torrentio.strem.fun/videos/failed_infringement_v2.mp4`.
- A direct HTTP `451` download response is also normalized to `SOURCE_UNAVAILABLE` and never finalized as media.
- Hash-bearing provider jobs snapshot their own exact-hash account entries before source resolution. Successful media completion stores `cached`; `SOURCE_NOT_READY` stores short-lived `uncached`; every other failed provider resolver transfer stores `unavailable`. Negative download evidence replaces stale positive history and triggers provider-specific cleanup only for newly created exact-hash IDs.

Duplicate behavior:
- Backend must detect active duplicates before creating a new record.
- Active duplicate match rule:
  - same `metaId`
  - same `videoId`
  - same selected `sourceUrl`
  - and existing status in `queued`, `downloading`, `paused`, or `completed`
- If `videoId` is missing, fallback duplicate matching uses:
  - same `metaId`
  - same `type`
  - same selected `sourceUrl`
- Records with status `canceled`, `failed`, or `deleted` do not block a new create.

Response shape:
- New record: HTTP `201` with full download record and `duplicate: false`
- Duplicate active record: HTTP `200` with the existing full download record and `duplicate: true`

Runtime behavior:
- New records enter a FIFO scheduler and start when a configured concurrency slot is available.
- The backend runs at most two simultaneous transfers by default. `CUSTOM_STREMIO_MAX_CONCURRENT_DOWNLOADS` accepts a positive integer or `unlimited`.
- The queued record and its `queuedAt` time are durably stored before scheduler dispatch.
- The response returns before the file transfer completes.
- Frontend polling or refresh should read progress from later `GET /downloads` or `GET /downloads/:id` responses.

### 3. `GET /downloads`

Purpose:
- List download jobs.
- Includes records restored from local metadata storage after a backend restart.

Optional query:
- `metaId`

Response shape:

```json
{
  "items": [
    {
      "id": "dl_0001",
      "metaId": "tt1234567",
      "status": "queued",
      "queuePosition": 1,
      "queueLength": 3
    }
  ]
}
```

Queue metadata behavior:
- `queuePosition` is one-based among waiting FIFO records; position `1` is the next waiting record that will receive a free slot.
- `queueLength` is the current total number of records waiting in the scheduler.
- The fields are derived from the live scheduler for API responses and are not persisted in `download-records.json`.
- Positions update automatically after dispatch, pause, cancel, retry, resume, deletion, concurrency changes, and restart recovery.
- A record can briefly report `status: "queued"` with `queuePosition: null` while it is moving from the waiting queue into active startup. Frontends should present this as Starting rather than a numbered position.

### 4. `GET /downloads/:id`

Purpose:
- Fetch one download record by id.

Response shape:
- Full download record.

### 4A. `PATCH /downloads/:id/queue`

Purpose:
- Move one waiting download to a new one-based position in the queue.

Request shape:

```json
{
  "position": 1
}
```

Behavior notes:
- Only records that are currently waiting in `queued` state can be reordered. Active, paused, completed, failed, and canceled records return HTTP `409`.
- `position` must be a positive integer within the current waiting queue length; invalid or out-of-range values return HTTP `400`.
- Position `1` moves the record to the top of the waiting queue. Moving up or down uses the same endpoint with the adjacent position.
- The scheduler order changes immediately and the full waiting order is persisted before success is returned.
- Persistence failure attempts to restore both the prior scheduler order and stored records, then returns HTTP `500`.
- The response is the moved download record with updated live `queuePosition` and `queueLength` fields.

### 5. `POST /downloads/:id/pause`

Purpose:
- Pause a queued or active download while preserving its partial media file.

Request body:
- none

Response shape:
- HTTP `200` with the full record in `paused` state.

Behavior notes:
- Only `queued` and `downloading` records can transition to `paused`; incompatible states return HTTP `409`.
- A waiting queued record is removed before it can start. Pausing an active record releases its concurrency slot for the next waiting job.
- An active request and file stream are stopped before the response is returned.
- The `.part` file, trusted byte count, remote range capability, and available response validators remain on the record for a later resume.

### 6. `POST /downloads/:id/resume`

Purpose:
- Resume a paused download.

Request body:
- none

Response shape:
- HTTP `202` with the same full record reset to `queued` before the background transfer restarts.

Behavior notes:
- Only inactive `paused` records can resume; incompatible states return HTTP `409`.
- The destination and `.part` path are derived from trusted stored metadata. The actual partial-file size is the resume offset; caller-supplied paths and offsets are not accepted.
- A non-zero resume sends `Range: bytes=<offset>-` and sends `If-Range` when a strong `ETag` or `Last-Modified` validator was captured.
- The remote response must be `206 Partial Content` with a matching `Content-Range` start. A source that returns a full `200` response fails the record safely and preserves the partial bytes for inspection or Retry.
- A missing, invalid, or unexpectedly oversized partial file rejects the resume without starting a transfer.
- A successful preparation refreshes `queuedAt` and places the resumed record at the back of the FIFO queue.

### 7. `POST /downloads/:id/retry`

Purpose:
- Retry an inactive `failed` or `canceled` download from the beginning without creating a duplicate record.

Request body:
- none

Response shape:
- HTTP `202` with the same full download record reset to `queued`.

Behavior notes:
- Only `failed` and `canceled` records are accepted; other statuses return HTTP `409`.
- The backend requires the stored record to retain a supported HTTP/HTTPS `sourceUrl`.
- The destination is derived again from trusted record metadata. The API does not accept a caller-supplied path.
- Any final file and `.part` file at the derived destination are removed before restarting so stale bytes cannot be mistaken for completed media.
- Progress, byte totals, speed, ETA, completion time, and error state are reset.
- `attemptCount` increments and `lastAttemptAt` records the retry time. Legacy records without attempt metadata begin their retry as attempt `2`.
- `queuedAt` is refreshed so the retry enters at the back of the FIFO queue.
- The queued retry is persisted before its background transfer starts.

### 8. `POST /downloads/:id/cancel`

Purpose:
- Cancel a queued or active download without deleting the record immediately.

Request body:
- none

Response shape:
- Updated full download record.

Behavior notes:
- If the download is actively running, the backend aborts the active transfer and updates the record to `canceled`.
- If the record is waiting, it is removed from the scheduler and never opens a source request.
- Partial `.part` files remain on disk until the record is resumed, retried, or removed manually. Retry removes the derived artifacts before starting again.
- The canceled state is persisted across backend restarts.

### 9. `DELETE /downloads/:id`

Purpose:
- Delete a download record and, depending on later backend policy, optionally remove the local file.

Request body:
- none

Response shape:

```json
{
  "ok": true,
  "id": "dl_0001",
  "status": "deleted"
}
```

Behavior notes:
- The record is removed from persistent metadata.
- The downloaded or partial media file remains on disk.

### 10. `POST /downloads/:id/open-location`

Purpose:
- Open the stored media file's location in Windows File Explorer.

Security and behavior:
- Accepts only a stored download id in the route; callers cannot submit an arbitrary filesystem path.
- Selects the media file when it exists.
- Opens the known parent directory when the expected file is absent but its directory remains available.

Response shape:
- Success: `{ "ok": true, "downloadId": "dl_0001", "directoryPath": "C:\\Downloads\\Stremio Downloads", "opened": true }`
- Missing/invalid stored location: HTTP `409` or `410` with an error message.

### 11. `POST /settings/player/select`

Purpose:
- Open a native Windows `.exe` picker and persist the selected video player.

Behavior and security:
- The dialog is opened by the local backend because browsers do not expose a trustworthy absolute path from a file input.
- Only trusted local frontend origins may call the endpoint; local command-line requests without an `Origin` header remain available for diagnostics.
- Canceling returns current settings with `selectionCanceled: true` and does not change the saved path.
- A selection must be an absolute, existing regular `.exe` file before settings are written.
- The chosen path applies immediately and is stored in `%LOCALAPPDATA%\Custom Stremio\backend-settings.json`.
- `GET /settings`, `PATCH /settings`, and this selector endpoint share the trusted-local-origin policy because settings now include a local executable path.

### 12. `POST /play`

Purpose:
- Launch MPC-HC or the configured external player for a completed local file.

Request body:

- `downloadId` required

Response shape:

```json
{
  "ok": true,
  "downloadId": "dl_0001",
  "localPath": "C:\\Users\\User\\Videos\\Stremio Downloads\\Show Name\\Season 01\\S01E01 - Episode Title.mkv",
  "launched": true
}
```

Notes:
- Only records with status `completed` can be played.
- The backend resolves the canonical `localPath` from its own stored record. Arbitrary paths supplied by callers are not accepted.
- The player executable is selected under **Downloads -> Download options -> Video player** and applies without restarting. `CUSTOM_STREMIO_PLAYER_PATH` is retained only as a fallback when no saved selection exists.
- The backend validates that both the configured player and downloaded media are regular files before launching.
- The player is launched directly with the media path as a single process argument; no shell command is constructed.
- Expected errors include `400` for a missing id, `404` for an unknown record, `409` for a non-completed record, `410` for a missing downloaded file, and `503` for missing/invalid player configuration.

## Status Values

- `queued`
- `downloading`
- `paused`
- `completed`
- `canceled`
- `failed`
- `deleted`

## Progress Field Notes

- `bytesDownloaded` increases during active downloads.
- `bytesTotal` comes from `Content-Length` for full responses or the complete length in `Content-Range` for resumed responses.
- `progress` is a percentage when `bytesTotal` is known.
- If `Content-Length` is missing, `bytesTotal` remains `null` and `progress` stays `0` safely until completion.
- `speedBytesPerSecond` and `etaSeconds` are derived from current transfer progress.
- Resumed speed is calculated from bytes transferred in the current request rather than treating previously downloaded bytes as new throughput.
- `completedAt` is set when a download finishes successfully.
- `localPath` is set to the final target file path once the backend resolves the destination.
- `partialPath` points to the working `.part` file while bytes remain incomplete and becomes `null` after finalization.
- `resumeSupported` records observed byte-range support. A rejected range resume sets it to `false` and leaves the record failed so Retry can restart cleanly.

## Persistent Record Storage

- Records are stored in a versioned JSON document outside the media download directory.
- Default Windows path: `%LOCALAPPDATA%\Custom Stremio\download-records.json`
- `CUSTOM_STREMIO_DATA_DIR` overrides the metadata directory.
- Writes use an atomic temporary-file replacement, and frequent progress changes are coalesced.
- `completed`, `failed`, `canceled`, and already `paused` records are restored unchanged after restart.
- Waiting `queued` records with a saved manual `queueOrder` are restored in that order. Records without manual order continue using `queuedAt` FIFO and are dispatched as slots become available.
- Restored `downloading` records become `paused` with an interruption note and can be resumed explicitly.
- `deleted` records are omitted from storage.
- Invalid or unsupported metadata documents stop backend startup rather than being silently overwritten.

## Persistent AllDebrid Availability History

- Default Windows path: `%LOCALAPPDATA%\Custom Stremio\alldebrid-availability-history.json`
- `CUSTOM_STREMIO_DATA_DIR` overrides the containing data directory.
- The versioned JSON document uses atomic temporary-file replacement and is separate from account credentials and the pending-cleanup journal.
- Disconnecting AllDebrid does not delete this history. A user-facing clear-history control is intentionally deferred.

## Persistent Real-Debrid Availability and Cleanup

- Source-file observations are stored in `%LOCALAPPDATA%\Custom Stremio\realdebrid-availability-history.json`.
- Temporary torrent IDs awaiting verified deletion are stored separately in `%LOCALAPPDATA%\Custom Stremio\realdebrid-pending-cleanup.json`.
- `CUSTOM_STREMIO_DATA_DIR` overrides the containing directory for both files.
- Both versioned JSON documents use atomic temporary-file replacement. Availability history survives disconnect; pending cleanup is retried after backend restart.
- A user-facing clear-history control is deferred. Pending cleanup is safety state and cannot be discarded through the frontend.

## Persistent Backend Settings

- Settings are stored separately from download records in a versioned `backend-settings.json` document.
- Default Windows path: `%LOCALAPPDATA%\Custom Stremio\backend-settings.json`
- `CUSTOM_STREMIO_DATA_DIR` overrides the directory for both record and settings documents.
- Writes use atomic temporary-file replacement.
- The AllDebrid API key and Real-Debrid client secret/access/refresh tokens are stored only in this local backend document and are omitted from every frontend settings response. Protect the Windows account and data directory accordingly.
- Version-one concurrency-only, version-two AllDebrid, and version-three player settings migrate in memory with their existing values preserved, then write in version four on the next save.
- The saved `player.executablePath` is an absolute Windows `.exe` path used by `POST /play`; it is never supplied by the play request itself.
- A saved `downloads.maxConcurrentDownloads` value takes precedence over `CUSTOM_STREMIO_MAX_CONCURRENT_DOWNLOADS` on startup.
- When no saved document exists, the environment value is used if it is a positive integer or `unlimited`; otherwise the scheduler default is `2`.
- Invalid or unsupported settings documents stop backend startup rather than being silently overwritten.

## File Organization Rule

Intended default structure:

```text
Stremio Downloads/
  Movie Name (Year)/
    Movie Name (Year).mkv
```

```text
Stremio Downloads/
  Show Name/
    Season 01/
      S01E01 - Episode Title.mkv
```

Filenames and folder names must be sanitized for Windows.

Current implementation notes:
- Default root folder is `%USERPROFILE%\Downloads\Stremio Downloads`
- `CUSTOM_STREMIO_DOWNLOAD_DIR` overrides that root in development
- `parentTitle` is used for the top-level movie/show folder name
- `videoTitle` remains the episode or item-level title used in the file name

## Security Notes

- Bind to `127.0.0.1` only.
- Do not expose backend to LAN/internet.
- Validate URLs.
- Allow only `http` and `https` source URLs.
- Avoid logging sensitive RealDebrid/addon URLs in production.
- Treat resolved stream URLs as temporary.

## Future Notes

- SQLite remains an option if future global-library/query requirements outgrow the current single-file record store
- WebSocket/SSE progress updates later
- Additional Download options controls later for the download folder
- final desktop packaging later
