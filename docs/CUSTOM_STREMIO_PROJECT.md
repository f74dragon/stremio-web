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
- `3. Preferred addon stream sorting/filtering`: In progress (`Milestone 3A` implemented)
- `4. Add placeholder Download / Play Download buttons`: Not started
- `5. Create local backend prototype`: Not started
- `6. Implement real download manager`: Not started
- `7. Add title-specific downloads panel`: Not started
- `8. Add global downloads page`: Not started
- `9. Add MPC-HC launch support`: Not started
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

Run the app, choose a preferred addon on an episode stream page, and verify that the All addons view puts that addon first while manual addon filtering still works.

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
- Source changes for `Milestone 3A` are limited to `src/routes/MetaDetails/StreamsList/StreamsList.js`.

## Assumptions

- No feature implementation is done in this step.
- The tracker should describe current architecture truthfully without overcommitting to backend details.
- `docs/` is expected to be created as a new directory because it is currently missing.
