# Custom Stremio Playback Progress Contract

## Milestone 10A Decision

- MPC-HC remains responsible for resuming an exact local file through its native **Options -> Player -> History -> Remember File position** setting.
- The custom local backend will separately store observed position and duration for Stremio-facing progress, watched state, and future Continue Watching behavior.
- The launcher must continue passing only the media file path. Do not add `/start`, `/startpos`, or another forced seek unless a later design intentionally makes Custom Stremio the resume authority.
- Launching a file is not proof that it was watched. Watched state must be based on verified playback progress.

## Milestone 10B Implementation

- Stremio's internal player already reports time and duration changes to core and uses the library item's `timeOffset` when resuming the same video.
- Stremio core already exposes movie, episode, and season watched actions.
- `POST /play` validates and launches a completed record as before, then creates a playback session when tracking is enabled.
- The backend polls MPC-HC only through `127.0.0.1`, matches the exact reported local file, and records playing, paused, stopped, or unreachable observations.
- **Downloads -> Download options** contains opt-in setup, port configuration, localhost-only confirmation, and connection testing.
- External-player observations are persisted in `%LOCALAPPDATA%\Custom Stremio\playback-progress.json` and exposed through a sanitized read endpoint.
- Watched-state synchronization and Continue Watching presentation are intentionally not implemented yet.

## Verified MPC-HC Capabilities

- This workstation currently uses MPC-HC `2.7.0` at `C:\Program Files\MPC-HC\mpc-hc64.exe`.
- MPC-HC can remember a local file's position when both playback history and file-position memory are enabled.
- MPC-HC periodically saves meaningful position changes, forces a save while closing, and resets the remembered position when playback is at the end.
- Its optional Web Interface exposes playback state, current position, duration, and the current file path. The implementation reads the numeric fields from `variables.html` so it does not depend on localized state text.
- MPC-HC supports command-line start-position arguments, but using one by default would override its native remembered position.
- The Web Interface must be explicitly configured for localhost-only access before Custom Stremio relies on it. It must never be silently exposed to the LAN.

## State Ownership

| Concern | Owner |
| --- | --- |
| Resume the exact local file | MPC-HC native file history |
| Observe external-player position and duration | Custom local backend telemetry bridge |
| Persist progress for Custom Stremio UI | New local playback-progress store |
| Mark a movie or episode watched | Stremio core, after verified completion |
| Choose a future Continue Watching episode | Frontend using persisted progress and episode metadata |

The playback-progress store must be independent from active download records and permanent download history. Deleting a media file or download record must not silently erase viewing progress.

## Version-One Progress Record

```json
{
  "version": 1,
  "contentKey": "series:tt1234567:video-id",
  "downloadId": "dl_0001",
  "metaId": "tt1234567",
  "videoId": "video-id",
  "mediaType": "series",
  "title": "Episode title",
  "parentTitle": "Show title",
  "season": 1,
  "episode": 2,
  "localPath": "C:\\Users\\User\\Videos\\Stremio Downloads\\Show title\\Season 01\\S01E02 - Episode title.mkv",
  "positionMs": 1800000,
  "durationMs": 3000000,
  "progress": 0.6,
  "state": "paused",
  "startedAt": "2026-07-31T12:00:00.000Z",
  "lastObservedAt": "2026-07-31T12:30:00.000Z",
  "lastPlayedAt": "2026-07-31T12:30:00.000Z",
  "sessionEndedReason": null,
  "player": {
    "kind": "mpc-hc",
    "telemetry": "web-interface",
    "resumeOwner": "mpc-hc-history"
  }
}
```

- Movies use the Stremio meta id as their content identity.
- Episodes use the meta id plus video id. Season and episode numbers are descriptive metadata, not the sole identity.
- `downloadId` and normalized `localPath` identify the exact local source used by a playback session.
- A session created by `POST /play` must be matched to MPC-HC's reported file path before any position is persisted.
- Public backend requests must never be allowed to attach arbitrary filesystem paths to progress records.

## Completion and Watched Rules

- Do not mark watched when the player merely launches.
- Do not infer completion from the player becoming unreachable or closing.
- Require a valid duration and a verified near-end progress observation before marking completed.
- Final thresholds should be chosen after live telemetry testing; they should tolerate credits without treating brief playback as watched.
- Replaying completed media may update recency and position without creating duplicate content identities.
- Automatic next-episode selection belongs to a later frontend pass after external-player progress is reliable.

## Implemented Backend Surface

- `POST /settings/player/progress/test` performs a bounded loopback connection test using the requested port.
- `POST /play` returns an optional backend-created playback session id when tracking is enabled.
- `GET /playback/progress` returns current/recent progress without exposing full local paths and accepts an optional `metaId` filter.
- Progress is written atomically in the local Custom Stremio data directory.
- Polling exists only for backend-created playback sessions and stops after the file changes, MPC-HC stops, or telemetry remains unreachable.

## Next Pass: Milestone 10C

1. Live-test 10B against MPC-HC with History, Web Interface, and localhost-only access enabled.
2. Define and test watched/completion thresholds using real playback observations.
3. Synchronize verified completion with existing Stremio movie/episode watched actions without marking on launch.
4. Present persisted position in download details and title cards.
5. Add Continue Watching and next-episode selection only after watched synchronization is reliable.
