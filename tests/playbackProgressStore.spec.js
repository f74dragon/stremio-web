/* global describe, beforeEach, afterEach, test, expect */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    PLAYBACK_PROGRESS_STORE_VERSION,
    createPlaybackContentKey,
    readPlaybackProgress,
    PlaybackProgressStore
} = require('../local-backend/playbackProgressStore');

const createProgress = (overrides = {}) => ({
    contentKey: 'series:tt123:video-1',
    downloadId: 'dl_1',
    metaId: 'tt123',
    videoId: 'video-1',
    mediaType: 'series',
    title: 'Episode 1',
    parentTitle: 'Show',
    season: 1,
    episode: 1,
    localPath: 'C:\\Media\\Show\\S01E01.mkv',
    positionMs: 30000,
    durationMs: 60000,
    state: 'paused',
    startedAt: '2026-07-31T10:00:00.000Z',
    lastObservedAt: '2026-07-31T10:00:30.000Z',
    lastPlayedAt: '2026-07-31T10:00:30.000Z',
    ...overrides
});

describe('playbackProgressStore', () => {
    let tempDirectory;
    let filePath;

    beforeEach(() => {
        tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-stremio-playback-'));
        filePath = path.join(tempDirectory, 'state', 'playback-progress.json');
    });

    afterEach(() => {
        fs.rmSync(tempDirectory, { recursive: true, force: true });
    });

    test('builds stable movie and episode content identities', () => {
        expect(createPlaybackContentKey({ id: 'dl_1', type: 'movie', metaId: 'tt1' })).toBe('movie:tt1');
        expect(createPlaybackContentKey({ id: 'dl_2', type: 'series', metaId: 'tt2', videoId: 'ep2' })).toBe('series:tt2:ep2');
        expect(createPlaybackContentKey({ id: 'dl_3' })).toBe('download:dl_3');
    });

    test('persists the latest verified record atomically and restores it', async () => {
        const store = new PlaybackProgressStore({ filePath, debounceMs: 1 });
        await store.initialize();
        store.upsert(createProgress());
        store.upsert(createProgress({ positionMs: 45000, state: 'playing', lastObservedAt: '2026-07-31T10:00:45.000Z' }));
        await store.flush();

        const records = await readPlaybackProgress(filePath);
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
            version: PLAYBACK_PROGRESS_STORE_VERSION,
            positionMs: 45000,
            durationMs: 60000,
            progress: 0.75,
            state: 'playing'
        });
        expect(fs.readdirSync(path.dirname(filePath)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    });

    test('filters by meta id and never accepts an unverified relative path', async () => {
        const store = new PlaybackProgressStore({ filePath });
        await store.initialize();
        store.upsert(createProgress());
        store.upsert(createProgress({
            contentKey: 'movie:tt999',
            downloadId: 'dl_2',
            metaId: 'tt999',
            videoId: null,
            mediaType: 'movie',
            localPath: 'D:\\Movies\\Film.mkv',
            lastObservedAt: '2026-07-31T11:00:00.000Z',
            lastPlayedAt: '2026-07-31T11:00:00.000Z'
        }));
        expect(store.list({ metaId: 'tt123' })).toHaveLength(1);
        expect(() => store.upsert(createProgress({ localPath: 'relative.mkv' }))).toThrow(expect.objectContaining({
            code: 'PLAYBACK_PROGRESS_RECORD_INVALID'
        }));
    });

    test('rejects corrupt or unsupported documents instead of overwriting them', async () => {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, '{broken', 'utf8');
        await expect(readPlaybackProgress(filePath)).rejects.toMatchObject({ code: 'PLAYBACK_PROGRESS_STORE_INVALID' });
        fs.writeFileSync(filePath, JSON.stringify({ version: 99, records: [] }), 'utf8');
        await expect(readPlaybackProgress(filePath)).rejects.toMatchObject({ code: 'PLAYBACK_PROGRESS_STORE_UNSUPPORTED' });
    });
});
