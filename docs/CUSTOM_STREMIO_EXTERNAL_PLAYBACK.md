# External Playback Account Synchronization

## Setup

In Downloads -> Download options, configure the player and enable MPC-HC telemetry
with localhost-only access, then enable account sync. Sign in to Stremio and keep
Custom Stremio open. MPC-HC remains responsible for resuming the exact local file.

The sync service lives at app scope; navigating away from Downloads does not stop
it. It polls settings and verified local observations every five seconds. Moving
playback is written at most every fifteen seconds; a pause or 90% completion can
flush sooner. Backend or bridge failures remain retryable. Settings show sync or
retry/metadata status.

## Core contract

The locally built Core package adds:

```javascript
{
    action: 'Ctx',
    args: {
        action: 'ExternalPlaybackProgressChanged',
        args: {
            meta_item: { id, type, name, /* native preview fields, canonical videos for series */ },
            video_id: 'canonical-video-id',
            time: 120000,
            duration: 3600000,
            observed_at: '2026-10-24T12:00:00.000Z'
        }
    }
}
```

The action replaces position (including backward seeks), updates duration and last
played identity, and uses Core's `UpdateLibraryItem` path for storage, account API
persistence and native Continue Watching refresh. It does not invent elapsed watch
time, launch a player, or load/unload singleton models. Existing library membership
and notification settings are retained. A new item starts as temporary watch
history, like normal playback, rather than being permanently added to the library.

The frontend requires explicit opt-in and a completed download matching the exact
download id, content key, meta id, media type and episode id. Account ledgers are
separate and record only accepted bridge dispatches, not an acknowledgment of remote
API delivery. Core's normal library synchronization handles remote delivery. The
service listens for account write failures and retries Core's supported library
sync with a fifteen-second backoff; it also observes successful API acknowledgments.
Normal focus sync continues to work. An active native
Player postpones external updates. Older/equal observations cannot overwrite a
newer Core playback timestamp.

## Completion and episodes

- Before 90%, position appears in native account-backed Continue Watching.
- At 90% or above, a movie is marked watched and its resume offset is cleared.
- A series observation marks only its matching canonical episode's watched bit.
  Repeated completion observations do not increment it again. Native season UI
  derives watched state from the episode bits; no unobserved episodes are bulk-marked.
- Next-episode state follows Core's canonical metadata ordering, across seasons.
  Advancing requires a known released immediate next episode; it never guesses from
  the subset of files downloaded, jumps into specials from normal episodes, or
  advances to an upcoming/unknown-release episode. The final episode clears resume.
- This updates next-episode state; it does not automatically launch another file.
- Metadata is read through installed addons without touching MetaDetails. New series
  downloads retain a bounded compact snapshot of the full native episode list as a
  fallback. Legacy records without a list wait for a reachable metadata addon.
- Signed-in Home uses native Continue Watching, so local presentation cannot replace
  the canonical next episode. Signed-out local Home resume remains available.

## Verification before packaging

Automated checks exercise the real Core runtime, mocked account API/storage, the
installed WASM package, and frontend validation/retry behavior. They use synthetic
data and do not modify the user's Stremio account or media.

The live acceptance checklist uses an actual signed-in session and MPC-HC:

1. Play a completed downloaded movie, pause partway, navigate away from Downloads,
   and confirm native Home Continue Watching updates. Confirm it from a second
   Stremio client after account sync.
2. Seek backward and confirm the new position replaces the old one. Close/reopen
   MPC-HC and confirm its native file-position history still controls local resume.
3. Cross 90% on one episode and confirm only it is marked watched and the correct
   released episode becomes next, including a season boundary and the series end.
4. Disable sync, switch accounts, start the native player, or disconnect the backend;
   verify that updates stop or retry appropriately without affecting playback.

After the UI/crash fixes, the user reported the live playback/sync flow working and
accepted proceeding to Windows packaging. Individual results for every scenario
above were not recorded; retain them for desktop release verification. Windows
installer/launcher implementation is now the next project milestone. The custom
Core archive is already part of the normal web build.
