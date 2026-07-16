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

Set the media player executable path before starting the backend. The backend does not scan the filesystem or guess installation locations.

```powershell
$env:CUSTOM_STREMIO_PLAYER_PATH = 'C:\Program Files\MPC-HC\mpc-hc64.exe'
npm start
```

The setting applies to the current PowerShell session. `POST /play` accepts only a stored `downloadId`; callers cannot submit arbitrary local paths for the backend to open.

## Download Folder

Default root:

`%USERPROFILE%\Downloads\Stremio Downloads`

Override it with:

```powershell
$env:CUSTOM_STREMIO_DOWNLOAD_DIR = 'C:\Temp\Custom Stremio Downloads'
npm start
```

## Download Concurrency

The scheduler starts downloads in FIFO order and runs at most two transfers simultaneously by default. Set an explicit limit before starting the backend:

```powershell
$env:CUSTOM_STREMIO_MAX_CONCURRENT_DOWNLOADS = '1'
npm start
```

Accepted values are integers from `1` through `16`. Missing or invalid values use the default of `2`. Restart the backend after changing the environment setting.

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
- Retry derives the destination from stored record metadata and removes both its derived final file and `.part` file first; callers cannot supply a filesystem path.
- Partial files may remain after pause, cancel, or failure until the record is resumed, retried, or removed manually.

## PowerShell Test: Health

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:5577/health'
```

The response includes `downloads.maxConcurrent`, `downloads.active`, and `downloads.queued` scheduler diagnostics.

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
- `POST /downloads/:id/open-location` opens only locations derived from stored records; it does not accept caller-supplied paths.
- The first restart after upgrading from the older in-memory backend cannot recover records that were never written by that older process; their media files remain on disk.
- Waiting queued work is restored automatically in FIFO order; interrupted active transfers are restored as `paused` and can be resumed explicitly.
- Real file downloading is implemented only for direct `http`/`https` URLs in this milestone.
- Pause/resume requires the remote direct-file source to honor HTTP byte ranges. Unsupported sources fail safely and can still use Retry from byte zero.
- Completed records can be opened through `POST /play` when `CUSTOM_STREMIO_PLAYER_PATH` points to a valid player executable.
