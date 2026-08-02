/* global describe, test, expect, jest */

const { MpcHcPlaybackTracker } = require('../local-backend/mpcHcPlaybackTracker');

const createRecord = () => ({
    id: 'dl_1',
    status: 'completed',
    localPath: 'C:\\Media\\Show\\S01E01.mkv',
    type: 'series',
    metaId: 'tt123',
    videoId: 'video-1',
    parentTitle: 'Show',
    videoTitle: 'Episode 1',
    season: 1,
    episode: 1
});

const createStore = () => {
    const records = new Map();
    return {
        records,
        upsert: jest.fn((record) => {
            records.set(record.contentKey, record);
            return record;
        }),
        get: jest.fn((contentKey) => records.get(contentKey) || null)
    };
};

const createTracker = ({ client, store, now = () => Date.parse('2026-07-31T12:00:00.000Z'), maxConsecutiveFailures = 5 } = {}) => new MpcHcPlaybackTracker({
    client,
    store,
    now,
    idFactory: () => 'session-id',
    setTimer: jest.fn(() => 1),
    clearTimer: jest.fn(),
    maxConsecutiveFailures,
    onWarning: jest.fn()
});

describe('mpcHcPlaybackTracker', () => {
    test('persists progress only after MPC-HC reports the exact launched file', async () => {
        const client = { getStatus: jest.fn().mockResolvedValue({
            state: 'playing',
            positionMs: 120000,
            durationMs: 300000,
            filePath: 'c:\\media\\show\\s01e01.mkv'
        }) };
        const store = createStore();
        const tracker = createTracker({ client, store });
        const sessionInfo = tracker.start(createRecord(), { port: 13579 });
        const session = tracker.sessions.get(sessionInfo.id);
        await tracker.poll(session);

        expect(client.getStatus).toHaveBeenCalledWith(13579);
        expect(store.upsert).toHaveBeenCalledWith(expect.objectContaining({
            contentKey: 'series:tt123:video-1',
            downloadId: 'dl_1',
            positionMs: 120000,
            durationMs: 300000,
            state: 'playing'
        }));
        expect(tracker.getSession(sessionInfo.id)).toMatchObject({ matched: true, active: true });
    });

    test('does not attach another MPC-HC file to the launched download', async () => {
        const client = { getStatus: jest.fn().mockResolvedValue({
            state: 'playing', positionMs: 1000, durationMs: 2000, filePath: 'C:\\Media\\Other.mkv'
        }) };
        const store = createStore();
        const tracker = createTracker({ client, store });
        const sessionInfo = tracker.start(createRecord(), { port: 13579 });
        await tracker.poll(tracker.sessions.get(sessionInfo.id));
        expect(store.upsert).not.toHaveBeenCalled();
        expect(tracker.getSession(sessionInfo.id)).toMatchObject({ matched: false, active: true });
    });

    test('records a stopped state and closes the matching session', async () => {
        const client = { getStatus: jest.fn()
            .mockResolvedValueOnce({
                state: 'playing', positionMs: 240000, durationMs: 300000, filePath: 'C:\\Media\\Show\\S01E01.mkv'
            })
            .mockResolvedValueOnce({
                state: 'stopped', positionMs: 250000, durationMs: 300000, filePath: 'C:\\Media\\Show\\S01E01.mkv'
            }) };
        const store = createStore();
        const tracker = createTracker({ client, store });
        const sessionInfo = tracker.start(createRecord(), { port: 13579 });
        const session = tracker.sessions.get(sessionInfo.id);
        await tracker.poll(session);
        await tracker.poll(session);
        expect(tracker.getSession(sessionInfo.id)).toBeNull();
        expect(store.records.get('series:tt123:video-1')).toMatchObject({
            state: 'stopped',
            sessionEndedReason: 'player_stopped'
        });
    });

    test('preserves the last position and marks telemetry unreachable after repeated failures', async () => {
        const client = { getStatus: jest.fn()
            .mockResolvedValueOnce({
                state: 'playing', positionMs: 40000, durationMs: 100000, filePath: 'C:\\Media\\Show\\S01E01.mkv'
            })
            .mockRejectedValueOnce(new Error('offline')) };
        const store = createStore();
        const tracker = createTracker({ client, store, maxConsecutiveFailures: 1 });
        const sessionInfo = tracker.start(createRecord(), { port: 13579 });
        const session = tracker.sessions.get(sessionInfo.id);
        await tracker.poll(session);
        await tracker.poll(session);
        expect(tracker.getSession(sessionInfo.id)).toBeNull();
        expect(store.records.get('series:tt123:video-1')).toMatchObject({
            positionMs: 40000,
            state: 'unreachable',
            sessionEndedReason: 'player_unreachable'
        });
    });
});
