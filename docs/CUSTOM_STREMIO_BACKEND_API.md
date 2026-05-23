# Custom Stremio Local Backend API Contract

## Purpose

The local backend will run on the user’s machine and handle:

- direct video file downloads from resolved Stremio/RealDebrid stream URLs
- progress tracking
- pause/resume/cancel/delete
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

Example combined download record shape:

```json
{
  "id": "dl_0001",
  "metaId": "tt1234567",
  "type": "series",
  "videoId": "tt1234567:1:2",
  "videoTitle": "Episode Title",
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
  "error": null
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

Response shape:
- Full download record including generated backend fields.

### 3. `GET /downloads`

Purpose:
- List download jobs.

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
- Updated full download record.

### 6. `POST /downloads/:id/resume`

Purpose:
- Resume a paused download.

Request body:
- none

Response shape:
- Updated full download record.

### 7. `POST /downloads/:id/cancel`

Purpose:
- Cancel a queued or active download without deleting the record immediately.

Request body:
- none

Response shape:
- Updated full download record.

### 8. `DELETE /downloads/:id`

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

### 9. `POST /play`

Purpose:
- Launch MPC-HC or the configured external player for a completed local file.

Request body:

- `downloadId` optional
- `localPath` optional
- `preferExternalPlayer` default `true`

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
- Backend should require at least one of `downloadId` or `localPath`.
- If both are provided, `downloadId` should resolve to the canonical stored path and take precedence unless explicitly overridden later.

## Status Values

- `queued`
- `downloading`
- `paused`
- `completed`
- `canceled`
- `failed`
- `deleted`

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

## Security Notes

- Bind to `127.0.0.1` only.
- Do not expose backend to LAN/internet.
- Validate URLs.
- Avoid logging sensitive RealDebrid/addon URLs in production.
- Treat resolved stream URLs as temporary.

## Future Notes

- SQLite persistence later
- WebSocket/SSE progress updates later
- Settings page later for download folder and MPC-HC path
- final desktop packaging later
