/* global describe, beforeEach, afterEach, test, expect */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { deriveLocalPath, derivePartialPath, ensureParentDirectory } = require('../local-backend/fileUtils');
const { isDownloadResumable, prepareDownloadResume } = require('../local-backend/downloadResume');

describe('downloadResume', () => {
    let tempDirectory;
    let previousDownloadDirectory;

    beforeEach(() => {
        tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-stremio-resume-'));
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

    test('recognizes only paused records as resumable', () => {
        expect(isDownloadResumable({ status: 'paused' })).toBe(true);
        expect(isDownloadResumable({ status: 'downloading' })).toBe(false);
        expect(isDownloadResumable({ status: 'failed' })).toBe(false);
    });

    test('uses the partial file size as the trusted resume offset', async () => {
        const record = {
            id: 'dl_paused',
            status: 'paused',
            type: 'movie',
            parentTitle: 'Paused Movie',
            sourceUrl: 'https://example.com/movie.mp4',
            bytesDownloaded: 90,
            bytesTotal: 200,
            progress: 45,
            error: 'old message'
        };
        const localPath = deriveLocalPath(record);
        const partialPath = derivePartialPath(localPath);
        await ensureParentDirectory(partialPath);
        fs.writeFileSync(partialPath, Buffer.alloc(80));

        const result = await prepareDownloadResume(record, '2026-07-16T15:00:00.000Z');

        expect(result.resumeOffset).toBe(80);
        expect(result.record).toMatchObject({
            id: 'dl_paused',
            status: 'queued',
            localPath,
            partialPath,
            bytesDownloaded: 80,
            bytesTotal: 200,
            progress: 40,
            speedBytesPerSecond: 0,
            etaSeconds: null,
            completedAt: null,
            updatedAt: '2026-07-16T15:00:00.000Z',
            error: null
        });
    });

    test('allows a zero-byte paused transfer to restart without a partial file', async () => {
        const result = await prepareDownloadResume({
            id: 'dl_queued_pause',
            status: 'paused',
            type: 'movie',
            parentTitle: 'Queued Pause',
            sourceUrl: 'https://example.com/movie.mp4',
            bytesDownloaded: 0,
            bytesTotal: null
        });

        expect(result.resumeOffset).toBe(0);
        expect(result.record).toMatchObject({ status: 'queued', bytesDownloaded: 0, progress: 0 });
    });

    test('rejects a missing partial file when bytes were previously downloaded', async () => {
        await expect(prepareDownloadResume({
            id: 'dl_missing',
            status: 'paused',
            type: 'movie',
            parentTitle: 'Missing Partial',
            sourceUrl: 'https://example.com/movie.mp4',
            bytesDownloaded: 50,
            bytesTotal: 100
        })).rejects.toMatchObject({ code: 'DOWNLOAD_PARTIAL_FILE_MISSING' });
    });

    test('rejects partial files larger than the expected media', async () => {
        const record = {
            id: 'dl_too_large',
            status: 'paused',
            type: 'movie',
            parentTitle: 'Oversized Partial',
            sourceUrl: 'https://example.com/movie.mp4',
            bytesDownloaded: 120,
            bytesTotal: 100
        };
        const partialPath = derivePartialPath(deriveLocalPath(record));
        await ensureParentDirectory(partialPath);
        fs.writeFileSync(partialPath, Buffer.alloc(120));

        await expect(prepareDownloadResume(record)).rejects.toMatchObject({
            code: 'DOWNLOAD_PARTIAL_FILE_TOO_LARGE'
        });
    });
});
