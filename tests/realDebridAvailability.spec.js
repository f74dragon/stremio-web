/* global jest, describe, beforeEach, afterEach, test, expect */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { RealDebridCleanupStore } = require('../local-backend/realDebridCleanupStore');
const { RealDebridAvailabilityStore } = require('../local-backend/realDebridAvailabilityStore');
const {
    createSourceKey,
    normalizeSources,
    matchSourceFile,
    RealDebridAvailabilityService
} = require('../local-backend/realDebridAvailability');

const HASH_CACHED = '842783e3005495d5d1637f5364b59343c7844707';
const HASH_UNCACHED = '194257a7bf4eaea978f4b5b7fbd3b4efcdd99e43';
const source = (hash = HASH_CACHED, overrides = {}) => ({
    hash,
    fileIdx: 1,
    filename: 'Show.S01E02.mkv',
    videoSize: 2000,
    ...overrides
});
const files = [
    { id: 1, path: '/Show.S01E01.mkv', bytes: 1000 },
    { id: 2, path: '/Show.S01E02.mkv', bytes: 2000 }
];

describe('RealDebridAvailabilityService', () => {
    let tempDirectory;
    let cleanupStore;
    let historyStore;

    beforeEach(() => {
        tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-stremio-rd-'));
        cleanupStore = new RealDebridCleanupStore({ filePath: path.join(tempDirectory, 'cleanup.json') });
        historyStore = new RealDebridAvailabilityStore({ filePath: path.join(tempDirectory, 'history.json') });
    });

    afterEach(() => {
        fs.rmSync(tempDirectory, { recursive: true, force: true });
    });

    test('normalizes exact source descriptors and rejects invalid input', () => {
        const normalized = normalizeSources([source(HASH_CACHED.toUpperCase()), source(), { hash: 'bad' }]);
        expect(normalized.valid).toHaveLength(1);
        expect(normalized.valid[0]).toMatchObject({ hash: HASH_CACHED, fileIdx: 1 });
        expect(normalized.valid[0].key).toBe(createSourceKey(normalized.valid[0]));
        expect(normalized.invalid).toHaveLength(1);
    });

    test('matches exact episode metadata and refuses ambiguous multi-file torrents', () => {
        expect(matchSourceFile(source(), files)).toMatchObject({ file: { id: '2' }, reason: 'exact_filename' });
        expect(matchSourceFile(source(HASH_CACHED, { filename: null, videoSize: null, fileIdx: 0 }), files))
            .toMatchObject({ file: { id: '1' }, reason: 'file_index' });
        expect(matchSourceFile(source(HASH_CACHED, { filename: null, videoSize: null, fileIdx: null }), files))
            .toEqual({ file: null, reason: 'ambiguous_files' });
    });

    test('detects an instantly cached exact file and verifies cleanup', async () => {
        const client = {
            getTorrents: jest.fn()
                .mockResolvedValueOnce([{ id: 'existing', hash: HASH_CACHED }])
                .mockResolvedValueOnce([{ id: 'existing', hash: HASH_CACHED }]),
            addMagnet: jest.fn().mockResolvedValue({ id: 'temporary' }),
            getTorrentInfo: jest.fn()
                .mockResolvedValueOnce({ status: 'waiting_files_selection', files })
                .mockResolvedValueOnce({ status: 'downloaded', progress: 100, files }),
            selectFiles: jest.fn().mockResolvedValue(null),
            deleteTorrent: jest.fn().mockResolvedValue(null)
        };
        const service = new RealDebridAvailabilityService({ client, cleanupStore, historyStore, sleep: jest.fn() });

        const result = await service.check('token', [source()]);

        expect(result.items[0]).toMatchObject({ status: 'cached', providerStatus: 'downloaded' });
        expect(client.selectFiles).toHaveBeenCalledWith('token', 'temporary', ['2']);
        expect(client.deleteTorrent).toHaveBeenCalledWith('token', 'temporary');
        expect(await cleanupStore.load()).toEqual([]);
        await expect(service.getHistory([source()])).resolves.toMatchObject({
            items: [expect.objectContaining({ status: 'cached', source: 'explicit_check' })]
        });
    });

    test('classifies a persistent queued state as uncached and deletes it', async () => {
        let now = 0;
        const client = {
            getTorrents: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]),
            addMagnet: jest.fn().mockResolvedValue({ id: 'queued-id' }),
            getTorrentInfo: jest.fn()
                .mockResolvedValueOnce({ status: 'waiting_files_selection', files })
                .mockResolvedValue({ status: 'queued', progress: 0, speed: 0, files }),
            selectFiles: jest.fn().mockResolvedValue(null),
            deleteTorrent: jest.fn().mockResolvedValue(null)
        };
        const service = new RealDebridAvailabilityService({
            client,
            cleanupStore,
            historyStore,
            now: () => now,
            sleep: jest.fn(async (milliseconds) => { now += milliseconds; })
        });

        const result = await service.check('token', [source(HASH_UNCACHED)]);

        expect(result.items[0]).toMatchObject({ status: 'uncached', providerStatus: 'queued' });
        expect(client.deleteTorrent).toHaveBeenCalledWith('token', 'queued-id');
        expect(await cleanupStore.load()).toEqual([]);
    });

    test('returns unknown without selecting when exact file matching is ambiguous', async () => {
        const client = {
            getTorrents: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]),
            addMagnet: jest.fn().mockResolvedValue({ id: 'ambiguous-id' }),
            getTorrentInfo: jest.fn().mockResolvedValue({ status: 'waiting_files_selection', files }),
            selectFiles: jest.fn(),
            deleteTorrent: jest.fn().mockResolvedValue(null)
        };
        const service = new RealDebridAvailabilityService({ client, cleanupStore, historyStore, sleep: jest.fn() });
        const result = await service.check('token', [source(HASH_CACHED, { fileIdx: null, filename: null, videoSize: null })]);

        expect(result.items[0]).toMatchObject({ status: 'unknown' });
        expect(client.selectFiles).not.toHaveBeenCalled();
        expect(client.deleteTorrent).toHaveBeenCalledWith('token', 'ambiguous-id');
    });

    test('treats HTTP 451 as unavailable without creating a cleanup record', async () => {
        const client = {
            getTorrents: jest.fn().mockResolvedValue([]),
            addMagnet: jest.fn().mockRejectedValue(Object.assign(new Error('infringing_file'), { status: 451, providerCode: 35 }))
        };
        const service = new RealDebridAvailabilityService({ client, cleanupStore, historyStore });
        const result = await service.check('token', [source()]);

        expect(result.items[0]).toMatchObject({ status: 'unavailable' });
        expect(await cleanupStore.load()).toEqual([]);
    });

    test('never selects or deletes when Real-Debrid returns a pre-existing same-hash ID', async () => {
        const client = {
            getTorrents: jest.fn().mockResolvedValue([{ id: 'protected', hash: HASH_CACHED }]),
            addMagnet: jest.fn().mockResolvedValue({ id: 'protected' }),
            getTorrentInfo: jest.fn(),
            selectFiles: jest.fn(),
            deleteTorrent: jest.fn()
        };
        const service = new RealDebridAvailabilityService({ client, cleanupStore, historyStore });
        const result = await service.check('token', [source()]);

        expect(result.items[0]).toMatchObject({ status: 'error' });
        expect(client.getTorrentInfo).not.toHaveBeenCalled();
        expect(client.selectFiles).not.toHaveBeenCalled();
        expect(client.deleteTorrent).not.toHaveBeenCalled();
        expect(await cleanupStore.load()).toEqual([]);
    });

    test('replaces an unexpired cached file observation when a later check proves it is not instant', async () => {
        let now = Date.parse('2026-07-19T12:00:00.000Z');
        const cachedClient = {
            getTorrents: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]),
            addMagnet: jest.fn().mockResolvedValue({ id: 'cached-id' }),
            getTorrentInfo: jest.fn()
                .mockResolvedValueOnce({ status: 'waiting_files_selection', files })
                .mockResolvedValueOnce({ status: 'downloaded', progress: 100, files }),
            selectFiles: jest.fn().mockResolvedValue(null),
            deleteTorrent: jest.fn().mockResolvedValue(null)
        };
        const firstService = new RealDebridAvailabilityService({
            client: cachedClient,
            cleanupStore,
            historyStore,
            now: () => now,
            sleep: jest.fn()
        });
        await firstService.check('token', [source()]);

        now += 60 * 60 * 1000;
        const uncachedClient = {
            getTorrents: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]),
            addMagnet: jest.fn().mockResolvedValue({ id: 'uncached-id' }),
            getTorrentInfo: jest.fn()
                .mockResolvedValueOnce({ status: 'waiting_files_selection', files })
                .mockResolvedValue({ status: 'queued', progress: 0, speed: 0, files }),
            selectFiles: jest.fn().mockResolvedValue(null),
            deleteTorrent: jest.fn().mockResolvedValue(null)
        };
        const secondService = new RealDebridAvailabilityService({
            client: uncachedClient,
            cleanupStore,
            historyStore,
            now: () => now,
            sleep: jest.fn(async (milliseconds) => { now += milliseconds; })
        });
        await secondService.check('token', [source()]);

        await expect(secondService.getHistory([source()])).resolves.toMatchObject({
            items: [expect.objectContaining({ status: 'uncached' })]
        });
    });

    test('persists failed cleanup and completes it after restart', async () => {
        const client = {
            getTorrents: jest.fn().mockResolvedValueOnce([]).mockResolvedValue([{ id: 'orphan', hash: HASH_CACHED }]),
            addMagnet: jest.fn().mockResolvedValue({ id: 'orphan' }),
            getTorrentInfo: jest.fn().mockResolvedValue({ status: 'waiting_files_selection', files }),
            selectFiles: jest.fn().mockResolvedValue(null),
            deleteTorrent: jest.fn().mockRejectedValue(new Error('offline'))
        };
        const service = new RealDebridAvailabilityService({ client, cleanupStore, historyStore, sleep: jest.fn() });
        const result = await service.check('token', [source()]);
        expect(result.pendingCleanup).toBe(1);
        expect((await cleanupStore.load())[0]).toMatchObject({ id: 'orphan' });

        const recoveredClient = {
            deleteTorrent: jest.fn().mockRejectedValue(Object.assign(new Error('gone'), { status: 404 })),
            getTorrents: jest.fn().mockResolvedValue([])
        };
        const recovered = new RealDebridAvailabilityService({ client: recoveredClient, cleanupStore, historyStore, sleep: jest.fn() });
        await expect(recovered.retryPendingCleanup('token')).resolves.toEqual({ cleaned: 1, pending: 0 });
    });

    test('reconciles only new exact-hash IDs when addMagnet loses its response', async () => {
        const client = {
            getTorrents: jest.fn()
                .mockResolvedValueOnce([{ id: 'protected', hash: HASH_CACHED }])
                .mockResolvedValueOnce([
                    { id: 'protected', hash: HASH_CACHED },
                    { id: 'new-id', hash: HASH_CACHED },
                    { id: 'other', hash: HASH_UNCACHED }
                ])
                .mockResolvedValueOnce([{ id: 'protected', hash: HASH_CACHED }, { id: 'other', hash: HASH_UNCACHED }]),
            addMagnet: jest.fn().mockRejectedValue(new Error('response lost')),
            deleteTorrent: jest.fn().mockResolvedValue(null)
        };
        const service = new RealDebridAvailabilityService({ client, cleanupStore, historyStore, sleep: jest.fn() });
        const result = await service.check('token', [source()]);

        expect(result.items[0]).toMatchObject({ status: 'error', error: 'response lost' });
        expect(client.deleteTorrent).toHaveBeenCalledWith('token', 'new-id');
        expect(client.deleteTorrent).not.toHaveBeenCalledWith('token', 'protected');
        expect(client.deleteTorrent).not.toHaveBeenCalledWith('token', 'other');
    });
});
