/* global describe, beforeEach, afterEach, test, expect */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    STORE_VERSION,
    INTERRUPTED_ERROR,
    readDownloadRecords,
    writeDownloadRecords,
    recoverInterruptedDownloadRecords,
    DownloadRecordStore
} = require('../local-backend/downloadRecordStore');

describe('downloadRecordStore', () => {
    let tempDirectory;
    let recordsPath;

    beforeEach(() => {
        tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-stremio-records-'));
        recordsPath = path.join(tempDirectory, 'state', 'download-records.json');
    });

    afterEach(() => {
        fs.rmSync(tempDirectory, { recursive: true, force: true });
    });

    test('starts with an empty collection when the store does not exist', async () => {
        await expect(readDownloadRecords(recordsPath)).resolves.toEqual([]);
    });

    test('writes and loads records while omitting deleted and invalid entries', async () => {
        await writeDownloadRecords(recordsPath, [
            {
                id: 'dl_completed',
                status: 'completed',
                localPath: 'C:\\Videos\\Movie.mkv',
                poster: 'https://images.example/movie-poster.jpg',
                logo: 'https://images.example/movie-logo.png',
                description: 'Movie summary',
                videoThumbnail: 'https://images.example/movie-thumbnail.jpg'
            },
            { id: 'dl_deleted', status: 'deleted' },
            { status: 'failed' },
            null
        ]);

        await expect(readDownloadRecords(recordsPath)).resolves.toEqual([
            {
                id: 'dl_completed',
                status: 'completed',
                localPath: 'C:\\Videos\\Movie.mkv',
                poster: 'https://images.example/movie-poster.jpg',
                logo: 'https://images.example/movie-logo.png',
                description: 'Movie summary',
                videoThumbnail: 'https://images.example/movie-thumbnail.jpg'
            }
        ]);

        const document = JSON.parse(fs.readFileSync(recordsPath, 'utf8'));
        expect(document.version).toBe(STORE_VERSION);
        expect(document.updatedAt).toEqual(expect.any(String));
        expect(fs.readdirSync(path.dirname(recordsPath))).toEqual(['download-records.json']);
    });

    test('coalesces scheduled updates and flushes the latest snapshot', async () => {
        const store = new DownloadRecordStore({
            filePath: recordsPath,
            debounceMs: 10000,
            onError: () => undefined
        });

        store.schedule([{ id: 'dl_1', status: 'downloading', progress: 20 }]);
        store.schedule([{ id: 'dl_1', status: 'completed', progress: 100 }]);
        await store.flush();

        await expect(store.load()).resolves.toEqual([
            { id: 'dl_1', status: 'completed', progress: 100 }
        ]);
    });

    test('marks interrupted active records as failed during startup recovery', () => {
        const recovery = recoverInterruptedDownloadRecords([
            { id: 'dl_queued', status: 'queued', speedBytesPerSecond: 10 },
            { id: 'dl_downloading', status: 'downloading', progress: 42 },
            { id: 'dl_paused', status: 'paused' },
            { id: 'dl_completed', status: 'completed', progress: 100 }
        ], '2026-07-15T12:00:00.000Z');

        expect(recovery.recoveredCount).toBe(3);
        expect(recovery.records.slice(0, 3)).toEqual([
            expect.objectContaining({
                id: 'dl_queued',
                status: 'failed',
                speedBytesPerSecond: 0,
                etaSeconds: null,
                completedAt: null,
                updatedAt: '2026-07-15T12:00:00.000Z',
                error: INTERRUPTED_ERROR
            }),
            expect.objectContaining({
                id: 'dl_downloading',
                status: 'failed',
                error: INTERRUPTED_ERROR
            }),
            expect.objectContaining({
                id: 'dl_paused',
                status: 'failed',
                error: INTERRUPTED_ERROR
            })
        ]);
        expect(recovery.records[3]).toEqual({
            id: 'dl_completed',
            status: 'completed',
            progress: 100
        });
    });

    test('rejects malformed state instead of silently overwriting it', async () => {
        fs.mkdirSync(path.dirname(recordsPath), { recursive: true });
        fs.writeFileSync(recordsPath, '{not valid json', 'utf8');

        await expect(readDownloadRecords(recordsPath)).rejects.toMatchObject({
            code: 'DOWNLOAD_RECORD_STORE_INVALID'
        });
    });
});
