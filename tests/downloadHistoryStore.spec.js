/* global describe, beforeEach, afterEach, test, expect */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    HISTORY_SCHEMA_VERSION,
    getBaseFileName,
    DownloadHistoryStore
} = require('../local-backend/downloadHistoryStore');

describe('DownloadHistoryStore', () => {
    let tempDirectory;
    let historyPath;
    let idCounter;
    let warnings;
    const now = '2026-07-20T12:00:00.000Z';

    const createStore = () => new DownloadHistoryStore({
        filePath: historyPath,
        now: () => now,
        idFactory: () => `event-${++idCounter}`,
        onWarning: (message) => warnings.push(message)
    });

    const createRecord = (overrides = {}) => ({
        id: 'dl-history-1',
        status: 'completed',
        metaId: 'tt1234567',
        type: 'movie',
        parentTitle: 'History Movie',
        poster: 'https://images.example/poster.jpg?token=temporary#fragment',
        addonName: 'Torrentio',
        debridProvider: 'realdebrid',
        streamName: '1080p source',
        fileName: 'History Movie.mkv',
        localPath: 'C:\\Users\\Viewer\\Downloads\\History Movie.mkv',
        bytesDownloaded: 1024,
        bytesTotal: 1024,
        attemptCount: 1,
        createdAt: '2026-07-20T11:55:00.000Z',
        completedAt: now,
        ...overrides
    });

    beforeEach(() => {
        tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-stremio-download-history-'));
        historyPath = path.join(tempDirectory, 'state', 'download-history.ndjson');
        idCounter = 0;
        warnings = [];
    });

    afterEach(() => {
        fs.rmSync(tempDirectory, { recursive: true, force: true });
    });

    test('appends immutable events and restores them newest first', async () => {
        const store = createStore();
        const record = createRecord();
        await store.append({
            eventType: 'download_created',
            eventKey: `record-seen:${record.id}`,
            record,
            occurredAt: record.createdAt,
            details: { status: 'queued' }
        });
        await store.append({
            eventType: 'download_completed',
            record,
            details: { previousStatus: 'downloading', status: 'completed' }
        });

        const reloaded = createStore();
        await expect(reloaded.list()).resolves.toMatchObject({
            version: HISTORY_SCHEMA_VERSION,
            total: 2,
            invalidEntryCount: 0,
            items: [
                expect.objectContaining({ eventType: 'download_completed', downloadId: record.id }),
                expect.objectContaining({ eventType: 'download_created', downloadId: record.id })
            ]
        });
        const result = await reloaded.list();
        expect(result.items[0].record).toMatchObject({
            media: { title: 'History Movie', poster: 'https://images.example/poster.jpg' },
            source: { addonName: 'Torrentio', provider: 'realdebrid', fileName: 'History Movie.mkv' },
            result: { status: 'completed', bytesTotal: 1024 }
        });
    });

    test('stores only allowlisted metadata and redacts links and credentials', async () => {
        const store = createStore();
        await store.append({
            eventType: 'download_failed',
            record: createRecord({
                parentTitle: 'Movie https://secret.example/watch?token=SUPERSECRET',
                addonName: 'apikey=SUPERSECRET',
                streamName: 'Authorization: SUPERSECRET',
                poster: 'https://user:password@images.example/poster.jpg?apikey=SUPERSECRET',
                downloadUrl: 'https://files.example/movie.mkv?apikey=SUPERSECRET',
                sourceUrl: 'https://files.example/movie.mkv?token=SUPERSECRET',
                error: 'Request failed for https://files.example/?token=SUPERSECRET'
            }),
            details: { status: 'failed' }
        });

        const serialized = fs.readFileSync(historyPath, 'utf8');
        expect(serialized).not.toContain('SUPERSECRET');
        expect(serialized).not.toContain('downloadUrl');
        expect(serialized).not.toContain('sourceUrl');
        expect(serialized).not.toContain('C:\\Users\\Viewer');
        const history = await store.list();
        expect(history.items[0].record.media.poster).toBe('https://images.example/poster.jpg');
        expect(history.items[0].record.media.title).toContain('[link removed]');
        expect(history.items[0].record.source.addonName).toBe('apikey=[redacted]');
    });

    test('reduces Windows and POSIX paths to basename-only history', () => {
        expect(getBaseFileName('C:\\Users\\Viewer\\Downloads\\Movie.mkv')).toBe('Movie.mkv');
        expect(getBaseFileName('/home/viewer/downloads/Movie.mkv')).toBe('Movie.mkv');
    });

    test('isolates a truncated line and keeps later events readable', async () => {
        const firstStore = createStore();
        await firstStore.append({ eventType: 'download_created', record: createRecord() });
        await fs.promises.appendFile(historyPath, '{"schemaVersion":1,"truncated"', 'utf8');

        const recoveredStore = createStore();
        await recoveredStore.append({
            eventType: 'download_failed',
            record: createRecord({ status: 'failed' })
        });

        const history = await recoveredStore.list();
        expect(history.total).toBe(2);
        expect(history.invalidEntryCount).toBe(1);
        expect(history.items.map(({ eventType }) => eventType)).toEqual(['download_failed', 'download_created']);
        expect(warnings).toEqual([expect.stringContaining('Ignoring invalid download history entry')]);
    });

    test('backfills each existing record once across restarts', async () => {
        const records = [
            createRecord(),
            createRecord({ id: 'dl-history-2', status: 'failed', completedAt: null })
        ];
        const firstStore = createStore();
        await expect(firstStore.backfill(records)).resolves.toBe(2);
        await expect(firstStore.backfill(records)).resolves.toBe(0);

        const reloadedStore = createStore();
        await expect(reloadedStore.backfill(records)).resolves.toBe(0);
        await expect(reloadedStore.list()).resolves.toMatchObject({ total: 2 });
    });

    test('deduplicates concurrent events with the same durable event key', async () => {
        const store = createStore();
        const input = {
            eventType: 'download_created',
            eventKey: 'record-seen:dl-history-1',
            record: createRecord()
        };
        await Promise.all([store.append(input), store.append(input), store.append(input)]);

        await expect(store.list()).resolves.toMatchObject({ total: 1 });
        expect(fs.readFileSync(historyPath, 'utf8').trim().split(/\r?\n/)).toHaveLength(1);
    });

    test('limits API reads without removing older history', async () => {
        const store = createStore();
        await store.append({ eventType: 'download_created', record: createRecord() });
        await store.append({ eventType: 'download_started', record: createRecord({ status: 'downloading' }) });
        await store.append({ eventType: 'download_completed', record: createRecord() });

        await expect(store.list({ limit: 2 })).resolves.toMatchObject({
            total: 3,
            items: [
                expect.objectContaining({ eventType: 'download_completed' }),
                expect.objectContaining({ eventType: 'download_started' })
            ]
        });
    });
});
