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
- `streamName`
- `streamDescription`
- `streamUrl`
- `externalUrl`
- `downloadUrl`
- `fileName`
- `streamingUrl`

The backend will generate and maintain these backend-only fields later:

- `id`
- `status`
- `localPath`
- `bytesDownloaded`
- `bytesTotal`
- `progress`
- `speedBytesPerSecond`
- `etaSeconds`
- `createdAt`
- `updatedAt`
- `completedAt`
- `error`
- `attemptCount`
- `lastAttemptAt`

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
  "streamName": "1080p BluRay",
  "streamDescription": "English, x264",
  "streamUrl": null,
  "externalUrl": null,
  "downloadUrl": "https://example.com/file.torrent",
  "fileName": "Episode.Title.S01E02.mkv",
  "streamingUrl": "http://127.0.0.1:11470/stream/...",
  "status": "queued",
  "localPath": null,
  "bytesDownloaded": 0,
  "bytesTotal": null,
  "progress": 0,
  "speedBytesPerSecond": 0,
  "etaSeconds": null,
  "createdAt": "2026-05-23T12:00:00.000Z",
  "updatedAt": "2026-05-23T12:00:00.000Z",
  "completedAt": null,
  "error": null,
  "attemptCount": 1,
  "lastAttemptAt": "2026-05-23T12:00:00.000Z",
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
  "time": "2026-05-23T12:00:00.000Z"
}
```

### 2. `POST /downloads`

Purpose:
- Create a new local download job from the frontend payload.

Request body:
- The frontend `buildDownloadPayload(input)` output fields listed above.

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
- New records start a real background direct-file download immediately after record creation.
- The queued record is durably stored before the background transfer starts.
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
      "status": "downloading"
    }
  ]
}
```

### 4. `GET /downloads/:id`

Purpose:
- Fetch one download record by id.

Response shape:
- Full download record.

### 5. `POST /downloads/:id/pause`

Purpose:
- Pause an active download if supported by the downloader.

Request body:
- none

Response shape:
- Current milestone limitation: HTTP `501`

```json
{
  "ok": false,
  "error": "Pause is not implemented yet"
}
```

### 6. `POST /downloads/:id/resume`

Purpose:
- Resume a paused download.

Request body:
- none

Response shape:
- Current milestone limitation: HTTP `501`

```json
{
  "ok": false,
  "error": "Resume is not implemented yet"
}
```

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
- Any file at that derived destination is removed before restarting so stale partial bytes cannot be mistaken for completed media.
- Progress, byte totals, speed, ETA, completion time, and error state are reset.
- `attemptCount` increments and `lastAttemptAt` records the retry time. Legacy records without attempt metadata begin their retry as attempt `2`.
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
- Partial files may remain on disk until the record is retried or removed manually. Retry removes the derived partial artifact before starting again.
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

### 11. `POST /play`

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
- The player executable must be explicitly configured through `CUSTOM_STREMIO_PLAYER_PATH` before the backend starts.
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
- `bytesTotal` comes from `Content-Length` when the remote server provides it.
- `progress` is a percentage when `bytesTotal` is known.
- If `Content-Length` is missing, `bytesTotal` remains `null` and `progress` stays `0` safely until completion.
- `speedBytesPerSecond` and `etaSeconds` are derived from current transfer progress.
- `completedAt` is set when a download finishes successfully.
- `localPath` is set to the final target file path once the backend resolves the destination.

## Persistent Record Storage

- Records are stored in a versioned JSON document outside the media download directory.
- Default Windows path: `%LOCALAPPDATA%\Custom Stremio\download-records.json`
- `CUSTOM_STREMIO_DATA_DIR` overrides the metadata directory.
- Writes use an atomic temporary-file replacement, and frequent progress changes are coalesced.
- `completed`, `failed`, and `canceled` records are restored unchanged after restart.
- Restored `queued`, `downloading`, or `paused` records become `failed` with an interruption error because transfer resume is not implemented.
- `deleted` records are omitted from storage.
- Invalid or unsupported metadata documents stop backend startup rather than being silently overwritten.

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
- Settings page later for download folder and MPC-HC path
- final desktop packaging later
