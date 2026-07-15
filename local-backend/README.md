# Custom Stremio Local Backend

Development-only local backend for the custom Stremio download flow.

It performs real direct HTTP/HTTPS file downloads in the background, stores records in memory, updates progress fields over time, and can launch completed local files in an explicitly configured media player. It still does not persist records or implement pause/resume.

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

## Current Download Behavior

- `POST /downloads` returns immediately with a queued record, then starts a background download.
- Records update in memory as the download moves through `queued`, `downloading`, `completed`, `failed`, or `canceled`.
- Duplicate prevention still applies before a new download starts.
- Only `http` and `https` source URLs are accepted.

## Cancel / Pause / Resume

- `POST /downloads/:id/cancel` stops an active download and marks the record `canceled`.
- Partial files may remain on disk after cancel or failure in this milestone.
- `POST /downloads/:id/pause` and `POST /downloads/:id/resume` currently return `501 Not Implemented`.

## PowerShell Test: Health

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:5577/health'
```

## PowerShell Test: Create Direct Download

Replace `downloadUrl` with a real direct video URL.

```powershell
$payload = @{
  metaId = 'tt1234567'
  type = 'movie'
  videoId = $null
  videoTitle = 'Test Movie'
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

## PowerShell Test: Play Completed Download

After `$created` reaches `completed`:

```powershell
$playPayload = @{
  downloadId = $created.id
} | ConvertTo-Json

Invoke-RestMethod -Uri 'http://127.0.0.1:5577/play' -Method Post -ContentType 'application/json' -Body $playPayload | ConvertTo-Json -Depth 8
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

- Records are still in memory only.
- Backend restarts lose records and active progress.
- Real file downloading is implemented only for direct `http`/`https` URLs in this milestone.
- Pause/resume are not implemented yet.
- Completed records can be opened through `POST /play` when `CUSTOM_STREMIO_PLAYER_PATH` points to a valid player executable.
