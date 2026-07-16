/* global describe, beforeEach, afterEach, test, expect */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { deriveLocalPath, derivePartialPath, ensureParentDirectory } = require('../local-backend/fileUtils');
const {
    isDownloadRetryable,
    prepareDownloadRetry
} = require('../local-backend/downloadRetry');

describe('downloadRetry', () => {
    let tempDirectory;
    let previousDownloadDirectory;

    beforeEach(() => {
        tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-stremio-retry-'));
        previousDownloadDirectory = process.env.CUSTOM_STREMIO_DOWNLOAD_DIR;
        process.env.CUSTOM_STREMIO_DOWNLOAD_DIR = tempDirectory;
    });

    afterEach(() => {
        if (previousDownloadDirectory === undefined) {
            delete process.env.CUSTOM_STREMIO_DOWNLOAD_DIR;
        } else {
            process.env.CUSTOM_STREMIO_DOWNLOAD_DIR = previousDownloadDirectory;
        }
        fs.rmSync(tempDirectory, { recursive: true, force: true });
    });

    test('recognizes only failed and canceled records as retryable', () => {
        expect(isDownloadRetryable({ status: 'failed' })).toBe(true);
        expect(isDownloadRetryable({ status: 'canceled' })).toBe(true);
        expect(isDownloadRetryable({ status: 'queued' })).toBe(false);
        expect(isDownloadRetryable({ status: 'downloading' })).toBe(false);
        expect(isDownloadRetryable({ status: 'completed' })).toBe(false);
    });

    test('removes the derived partial file and resets the same record for another attempt', async () => {
        const record = {
            id: 'dl_retry',
            status: 'failed',
            type: 'series',
            parentTitle: 'Example Show',
            videoTitle: 'Episode Name',
            season: 1,
            episode: 2,
            sourceUrl: 'https://example.com/video.mkv',
            localPath: 'C:\\Untrusted\\caller-path.mkv',
            bytesDownloaded: 512,
            bytesTotal: 1024,
            progress: 50,
            speedBytesPerSecond: 100,
            etaSeconds: 5,
            completedAt: '2026-07-15T12:00:00.000Z',
            error: 'Connection lost',
            attemptCount: 2,
            poster: 'https://images.example/poster.jpg'
        };
        const derivedPath = deriveLocalPath(record);
        const partialPath = derivePartialPath(derivedPath);
        await ensureParentDirectory(partialPath);
        fs.writeFileSync(derivedPath, 'stale final bytes');
        fs.writeFileSync(partialPath, 'partial bytes');

        const retriedRecord = await prepareDownloadRetry(record, '2026-07-16T12:00:00.000Z');

        expect(fs.existsSync(partialPath)).toBe(false);
        expect(fs.existsSync(derivedPath)).toBe(false);
        expect(retriedRecord).toEqual({
            ...record,
            status: 'queued',
            localPath: derivedPath,
            partialPath,
            bytesDownloaded: 0,
            bytesTotal: null,
            progress: 0,
            speedBytesPerSecond: 0,
            etaSeconds: null,
            queuedAt: '2026-07-16T12:00:00.000Z',
            updatedAt: '2026-07-16T12:00:00.000Z',
            completedAt: null,
            error: null,
            resumeSupported: null,
            sourceEtag: null,
            sourceLastModified: null,
            attemptCount: 3,
            lastAttemptAt: '2026-07-16T12:00:00.000Z'
        });
        expect(retriedRecord.poster).toBe(record.poster);
    });

    test('treats a legacy record without attempt metadata as its second attempt', async () => {
        const retriedRecord = await prepareDownloadRetry({
            id: 'dl_legacy',
            status: 'canceled',
            type: 'movie',
            parentTitle: 'Legacy Movie',
            sourceUrl: 'https://example.com/movie.mp4'
        }, '2026-07-16T13:00:00.000Z');

        expect(retriedRecord).toMatchObject({
            id: 'dl_legacy',
            status: 'queued',
            attemptCount: 2,
            lastAttemptAt: '2026-07-16T13:00:00.000Z'
        });
    });

    test('rejects completed records without touching their file', async () => {
        const record = {
            id: 'dl_completed',
            status: 'completed',
            type: 'movie',
            parentTitle: 'Completed Movie',
            sourceUrl: 'https://example.com/movie.mkv'
        };
        const localPath = deriveLocalPath(record);
        await ensureParentDirectory(localPath);
        fs.writeFileSync(localPath, 'completed media');

        await expect(prepareDownloadRetry(record)).rejects.toMatchObject({
            code: 'DOWNLOAD_NOT_RETRYABLE'
        });
        expect(fs.readFileSync(localPath, 'utf8')).toBe('completed media');
    });
});
