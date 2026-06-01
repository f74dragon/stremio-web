# Custom Stremio Local Backend

Development-only local backend placeholder for the custom Stremio download flow.

It currently exposes in-memory API endpoints for health checks and placeholder download records. It does not download files yet.

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

## Test: Health

```bash
curl http://127.0.0.1:5577/health
```

## Test: Create Download

```bash
curl -X POST http://127.0.0.1:5577/downloads \
  -H "Content-Type: application/json" \
  -d "{\"metaId\":\"tt1234567\",\"type\":\"series\",\"videoId\":\"tt1234567:1:2\",\"videoTitle\":\"Episode Title\",\"season\":1,\"episode\":2,\"videoReleased\":\"2024-03-01T00:00:00.000Z\",\"addonName\":\"Torrentio\",\"streamName\":\"1080p BluRay\",\"streamDescription\":\"English, x264\",\"streamUrl\":null,\"externalUrl\":null,\"downloadUrl\":\"https://example.com/file.torrent\",\"fileName\":\"Episode.Title.S01E02.mkv\",\"streamingUrl\":\"http://127.0.0.1:11470/stream/...\"}"
```

Duplicate behavior:

- First matching request creates a new record and returns `duplicate: false`.
- Repeating the same active request returns the existing record with `duplicate: true`.
- Matching is based on `metaId + videoId + sourceUrl` for normal video records.
- If `videoId` is missing, matching falls back to `metaId + type + sourceUrl`.
- Records with status `canceled`, `failed`, or `deleted` do not block a new create.

## Test: Duplicate Download Prevention

Run the same request twice:

```bash
curl -X POST http://127.0.0.1:5577/downloads \
  -H "Content-Type: application/json" \
  -d "{\"metaId\":\"tt1234567\",\"type\":\"series\",\"videoId\":\"tt1234567:1:2\",\"videoTitle\":\"Episode Title\",\"season\":1,\"episode\":2,\"videoReleased\":\"2024-03-01T00:00:00.000Z\",\"addonName\":\"Torrentio\",\"streamName\":\"1080p BluRay\",\"streamDescription\":\"English, x264\",\"streamUrl\":null,\"externalUrl\":null,\"downloadUrl\":\"https://example.com/file.torrent\",\"fileName\":\"Episode.Title.S01E02.mkv\",\"streamingUrl\":\"http://127.0.0.1:11470/stream/...\"}"
```

- The first response should include `duplicate: false`.
- The second response should return the same record id with `duplicate: true`.
- `GET /downloads` should still show only one active record.
- After `POST /downloads/:id/cancel`, the same payload can create a fresh record again.

## Test: Create Download Without Usable URL

```bash
curl -X POST http://127.0.0.1:5577/downloads \
  -H "Content-Type: application/json" \
  -d "{\"metaId\":\"tt1234567\",\"type\":\"series\",\"videoId\":\"tt1234567:1:2\",\"videoTitle\":\"Episode Title\"}"
```

## Test: List Downloads

```bash
curl http://127.0.0.1:5577/downloads
```

Filter by `metaId`:

```bash
curl "http://127.0.0.1:5577/downloads?metaId=tt1234567"
```

## Test: Get One Download

Replace `dl_...` with an id returned from `POST /downloads`.

```bash
curl http://127.0.0.1:5577/downloads/dl_1234567890_1
```

## Placeholder Lifecycle Endpoints

Pause:

```bash
curl -X POST http://127.0.0.1:5577/downloads/dl_1234567890_1/pause
```

Resume:

```bash
curl -X POST http://127.0.0.1:5577/downloads/dl_1234567890_1/resume
```

Cancel:

```bash
curl -X POST http://127.0.0.1:5577/downloads/dl_1234567890_1/cancel
```

Delete:

```bash
curl -X DELETE http://127.0.0.1:5577/downloads/dl_1234567890_1
```

## Notes

- This is a development placeholder only.
- It stores download records in memory only.
- It does not download files yet.
- It does not persist data across restarts.
- It does not launch MPC-HC yet.
