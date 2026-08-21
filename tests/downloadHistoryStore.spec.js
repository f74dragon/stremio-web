/* global describe, beforeEach, afterEach, test, expect */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    HISTORY_SCHEMA_VERSION,
    MAX_HISTORY_LIMIT,
    getBaseFileName,
    normalizeHistoryEvent,
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
            filteredTotal: 3,
            hasMore: true,
            items: [
                expect.objectContaining({ eventType: 'download_completed' }),
                expect.objectContaining({ eventType: 'download_started' })
            ]
        });
    });

    test('uses deterministic cursors to traverse more than the maximum page size', async () => {
        const events = Array.from({ length: MAX_HISTORY_LIMIT + 5 }, (_, index) => normalizeHistoryEvent({
            eventId: `archive-${index}`,
            eventType: 'download_started',
            occurredAt: now,
            record: createRecord({ id: `dl-archive-${index}`, status: 'downloading' })
        }));
        fs.mkdirSync(path.dirname(historyPath), { recursive: true });
        fs.writeFileSync(historyPath, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8');

        const store = createStore();
        const firstPage = await store.list({ limit: MAX_HISTORY_LIMIT });
        expect(firstPage).toMatchObject({
            total: MAX_HISTORY_LIMIT + 5,
            filteredTotal: MAX_HISTORY_LIMIT + 5,
            hasMore: true
        });
        expect(firstPage.items).toHaveLength(MAX_HISTORY_LIMIT);
        expect(firstPage.items[0].eventId).toBe(`archive-${MAX_HISTORY_LIMIT + 4}`);
        expect(firstPage.items[MAX_HISTORY_LIMIT - 1].eventId).toBe('archive-5');

        const secondPage = await store.list({ limit: MAX_HISTORY_LIMIT, cursor: firstPage.nextCursor });
        expect(secondPage).toMatchObject({
            total: MAX_HISTORY_LIMIT + 5,
            filteredTotal: MAX_HISTORY_LIMIT + 5,
            hasMore: false,
            nextCursor: null
        });
        expect(secondPage.items.map(({ eventId }) => eventId)).toEqual([
            'archive-4',
            'archive-3',
            'archive-2',
            'archive-1',
            'archive-0'
        ]);
        expect(new Set([...firstPage.items, ...secondPage.items].map(({ eventId }) => eventId))).toHaveProperty('size', MAX_HISTORY_LIMIT + 5);
    });

    test('keeps a cursor traversal on its original archive snapshot while new events append', async () => {
        const store = createStore();
        for (let index = 1; index <= 5; index += 1) {
            await store.append({
                eventId: `snapshot-${index}`,
                eventType: 'download_started',
                record: createRecord({ id: `dl-snapshot-${index}`, status: 'downloading' })
            });
        }

        const firstPage = await store.list({ limit: 2 });
        expect(firstPage.items.map(({ eventId }) => eventId)).toEqual(['snapshot-5', 'snapshot-4']);
        await store.append({
            eventId: 'snapshot-6',
            eventType: 'download_completed',
            record: createRecord({ id: 'dl-snapshot-6' })
        });

        const secondPage = await store.list({ limit: 2, cursor: firstPage.nextCursor });
        expect(secondPage).toMatchObject({ total: 5, filteredTotal: 5, hasMore: true });
        expect(secondPage.items.map(({ eventId }) => eventId)).toEqual(['snapshot-3', 'snapshot-2']);
        const thirdPage = await store.list({ limit: 2, cursor: secondPage.nextCursor });
        expect(thirdPage.items.map(({ eventId }) => eventId)).toEqual(['snapshot-1']);
        expect(thirdPage.hasMore).toBe(false);

        const refreshedFirstPage = await store.list({ limit: 2 });
        expect(refreshedFirstPage.total).toBe(6);
        expect(refreshedFirstPage.items[0].eventId).toBe('snapshot-6');
    });

    test('filters an inclusive ISO date range across cursor pages', async () => {
        const store = createStore();
        for (let day = 18; day <= 21; day += 1) {
            await store.append({
                eventId: `date-${day}`,
                eventType: 'download_completed',
                occurredAt: `2026-07-${day}T12:00:00.000Z`,
                record: createRecord({ id: `dl-date-${day}` })
            });
        }

        const firstPage = await store.list({
            limit: 1,
            from: '2026-07-19T08:00:00.000-04:00',
            to: '2026-07-20T12:00:00.000Z'
        });
        expect(firstPage).toMatchObject({
            total: 4,
            filteredTotal: 2,
            hasMore: true,
            items: [expect.objectContaining({ eventId: 'date-20' })]
        });

        const secondPage = await store.list({
            limit: 1,
            cursor: firstPage.nextCursor,
            from: '2026-07-19T12:00:00.000Z',
            to: '2026-07-20T12:00:00.000Z'
        });
        expect(secondPage).toMatchObject({
            total: 4,
            filteredTotal: 2,
            hasMore: false,
            nextCursor: null,
            items: [expect.objectContaining({ eventId: 'date-19' })]
        });
    });

    test('rejects malformed dates, reversed ranges, cursors, and cursor filter changes', async () => {
        const store = createStore();
        await store.append({ eventType: 'download_created', record: createRecord() });
        await store.append({ eventType: 'download_completed', record: createRecord() });

        await expect(store.list({ from: '2026-02-30T12:00:00.000Z' })).rejects.toMatchObject({
            code: 'INVALID_HISTORY_DATE'
        });
        await expect(store.list({ from: '2026-07-21T12:00:00.000Z', to: '2026-07-20T12:00:00.000Z' })).rejects.toMatchObject({
            code: 'INVALID_HISTORY_DATE_RANGE'
        });
        await expect(store.list({ cursor: 'not-a-valid-cursor!' })).rejects.toMatchObject({
            code: 'INVALID_HISTORY_CURSOR'
        });

        const firstPage = await store.list({ limit: 1, from: '2026-07-20T00:00:00.000Z' });
        await expect(store.list({ limit: 1, cursor: firstPage.nextCursor })).rejects.toMatchObject({
            code: 'HISTORY_CURSOR_FILTER_MISMATCH'
        });
    });

    test('rejects a cursor when its archive snapshot has changed', async () => {
        const store = createStore();
        await store.append({ eventId: 'stale-1', eventType: 'download_created', record: createRecord() });
        await store.append({ eventId: 'stale-2', eventType: 'download_completed', record: createRecord() });
        const firstPage = await store.list({ limit: 1 });

        const remainingLine = fs.readFileSync(historyPath, 'utf8').trim().split(/\r?\n/)[0];
        fs.writeFileSync(historyPath, `${remainingLine}\n`, 'utf8');
        const reloaded = createStore();
        await expect(reloaded.list({ limit: 1, cursor: firstPage.nextCursor })).rejects.toMatchObject({
            code: 'STALE_HISTORY_CURSOR'
        });
    });
});
