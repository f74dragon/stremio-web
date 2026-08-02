/* global jest, describe, beforeEach, afterEach, test, expect */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { derivePartialPath, createFileIdentity } = require('../local-backend/fileUtils');

jest.setTimeout(20000);

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const getFreePort = () => new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        server.close((error) => error ? reject(error) : resolve(port));
    });
});

const requestJson = (port, requestPath, { method = 'GET', body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const request = http.request({
        host: '127.0.0.1',
        port,
        path: requestPath,
        method,
        headers: payload === null ? headers : {
            ...headers,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({
                statusCode: response.statusCode,
                body: text ? JSON.parse(text) : null
            });
        });
    });
    request.once('error', reject);
    if (payload !== null) {
        request.write(payload);
    }
    request.end();
});

const waitFor = async (callback, timeoutMs = 10000) => {
    const startedAt = Date.now();
    let lastError;
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const result = await callback();
            if (result) {
                return result;
            }
        } catch (error) {
            lastError = error;
        }
        await delay(50);
    }

    throw lastError || new Error('Timed out waiting for condition');
};

const stopChildProcess = async (childProcess) => {
    if (!childProcess || childProcess.exitCode !== null) {
        return;
    }

    await new Promise((resolve) => {
        const timeoutId = setTimeout(resolve, 3000);
        childProcess.once('exit', () => {
            clearTimeout(timeoutId);
            resolve();
        });
        childProcess.kill('SIGTERM');
    });
};

describe('download lifecycle API integration', () => {
    let tempDirectory;
    let backendProcess;
    let backendPort;
    let sourceServer;
    let sourcePort;
    let sourceShouldFail;
    let sourceSupportsRanges;
    let sourceMedia;
    let sourceChunkSize;
    let sourceChunkDelayMs;
    let lastRangeHeader;
    let lastIfRangeHeader;
    let sourceRequests;

    const startBackend = async () => {
        backendProcess = spawn(process.execPath, [path.join(__dirname, '..', 'local-backend', 'server.js')], {
            cwd: path.join(__dirname, '..'),
            env: {
                ...process.env,
                PORT: String(backendPort),
                CUSTOM_STREMIO_DATA_DIR: path.join(tempDirectory, 'data'),
                CUSTOM_STREMIO_DOWNLOAD_DIR: path.join(tempDirectory, 'downloads'),
                CUSTOM_STREMIO_MAX_CONCURRENT_DOWNLOADS: '1'
            },
            stdio: 'ignore',
            windowsHide: true
        });

        await waitFor(async () => {
            const health = await requestJson(backendPort, '/health');
            return health.statusCode === 200;
        });
    };

    const seedDownloadRecords = async (records) => {
        await stopChildProcess(backendProcess);
        backendProcess = null;
        const dataDirectory = path.join(tempDirectory, 'data');
        fs.mkdirSync(dataDirectory, { recursive: true });
        fs.writeFileSync(path.join(dataDirectory, 'download-records.json'), `${JSON.stringify({
            version: 1,
            updatedAt: new Date().toISOString(),
            records
        }, null, 2)}\n`);
        await startBackend();
    };

    const createSharedCanceledRecords = (partialFileIdentity = null) => {
        const localPath = path.join(tempDirectory, 'downloads', 'Shared Canceled Movie', 'Shared Canceled Movie.mp4');
        const partialPath = derivePartialPath(localPath);
        const now = new Date().toISOString();
        return [1, 2, 3].map((number) => ({
            id: `shared-canceled-${number}`,
            status: 'canceled',
            type: 'movie',
            metaId: 'tt-shared-canceled',
            parentTitle: 'Shared Canceled Movie',
            videoTitle: 'Shared Canceled Movie',
            streamName: `Source ${number}`,
            sourceUrl: `https://source-${number}.example/media.mp4`,
            localPath,
            partialPath,
            partialFileIdentity,
            bytesDownloaded: partialFileIdentity?.size || 0,
            bytesTotal: null,
            progress: 0,
            speedBytesPerSecond: 0,
            etaSeconds: null,
            createdAt: now,
            updatedAt: now,
            completedAt: null
        }));
    };

    beforeEach(async () => {
        tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-stremio-retry-api-'));
        backendPort = await getFreePort();
        sourcePort = await getFreePort();
        sourceShouldFail = true;
        sourceSupportsRanges = true;
        sourceMedia = Buffer.from('retry integration media');
        sourceChunkSize = sourceMedia.length;
        sourceChunkDelayMs = 0;
        lastRangeHeader = null;
        lastIfRangeHeader = null;
        sourceRequests = [];
        sourceServer = http.createServer((request, response) => {
            sourceRequests.push({
                path: request.url,
                range: request.headers.range || null
            });
            if (sourceShouldFail) {
                response.writeHead(503, { 'Content-Type': 'text/plain' });
                response.end('temporarily unavailable');
                return;
            }

            lastRangeHeader = request.headers.range || null;
            lastIfRangeHeader = request.headers['if-range'] || null;
            const rangeMatch = /^bytes=(\d+)-$/.exec(lastRangeHeader || '');
            const rangeStart = rangeMatch ? Number(rangeMatch[1]) : 0;
            if (rangeMatch && sourceSupportsRanges && rangeStart >= sourceMedia.length) {
                response.writeHead(416, { 'Content-Range': `bytes */${sourceMedia.length}` });
                response.end();
                return;
            }

            const useRange = Boolean(rangeMatch && sourceSupportsRanges);
            const responseMedia = useRange ? sourceMedia.subarray(rangeStart) : sourceMedia;
            response.writeHead(useRange ? 206 : 200, {
                'Content-Type': 'video/mp4',
                'Content-Length': responseMedia.length,
                ETag: '"integration-v1"',
                ...(sourceSupportsRanges ? { 'Accept-Ranges': 'bytes' } : {}),
                ...(useRange ? { 'Content-Range': `bytes ${rangeStart}-${sourceMedia.length - 1}/${sourceMedia.length}` } : {})
            });

            if (sourceChunkDelayMs === 0 || sourceChunkSize >= responseMedia.length) {
                response.end(responseMedia);
                return;
            }

            let offset = 0;
            let timeoutId = null;
            const sendNextChunk = () => {
                if (response.destroyed || response.writableEnded) {
                    return;
                }
                const nextOffset = Math.min(responseMedia.length, offset + sourceChunkSize);
                response.write(responseMedia.subarray(offset, nextOffset));
                offset = nextOffset;
                if (offset >= responseMedia.length) {
                    response.end();
                } else {
                    timeoutId = setTimeout(sendNextChunk, sourceChunkDelayMs);
                }
            };
            response.once('close', () => clearTimeout(timeoutId));
            sendNextChunk();
        });
        await new Promise((resolve, reject) => {
            sourceServer.once('error', reject);
            sourceServer.listen(sourcePort, '127.0.0.1', resolve);
        });

        await startBackend();
    });

    afterEach(async () => {
        await stopChildProcess(backendProcess);
        if (sourceServer) {
            const closed = new Promise((resolve) => sourceServer.close(resolve));
            sourceServer.closeAllConnections?.();
            await closed;
        }
        fs.rmSync(tempDirectory, { recursive: true, force: true });
    });

    test('rejects provider-scoped known-negative downloads before contacting the source URL', async () => {
        const realDebridResponse = await requestJson(backendPort, '/downloads', {
            method: 'POST',
            body: {
                metaId: 'tt-rd-unavailable',
                type: 'movie',
                parentTitle: 'Unavailable RD Movie',
                addonName: 'Torrentio RD',
                debridProvider: 'realdebrid',
                sourceReadiness: 'unavailable',
                downloadUrl: `http://127.0.0.1:${sourcePort}/rd-placeholder.mp4`
            }
        });
        expect(realDebridResponse).toMatchObject({
            statusCode: 409,
            body: {
                errorCode: 'SOURCE_UNAVAILABLE',
                error: 'This source is unavailable on Real-Debrid. Choose a cached source instead.'
            }
        });

        const allDebridResponse = await requestJson(backendPort, '/downloads', {
            method: 'POST',
            body: {
                metaId: 'tt-ad-uncached',
                type: 'movie',
                parentTitle: 'Uncached AD Movie',
                addonName: 'Torrentio AD',
                debridProvider: 'alldebrid',
                sourceReadiness: 'requires_caching',
                downloadUrl: `http://127.0.0.1:${sourcePort}/ad-placeholder.mp4`
            }
        });
        expect(allDebridResponse.statusCode).toBe(409);
        expect(allDebridResponse.body.error).toContain('not cached on AllDebrid');

        const hash = '842783e3005495d5d1637f5364b59343c7844707';
        const dataDirectory = path.join(tempDirectory, 'data');
        fs.mkdirSync(dataDirectory, { recursive: true });
        fs.writeFileSync(path.join(dataDirectory, 'realdebrid-availability-history.json'), JSON.stringify({
            version: 1,
            updatedAt: new Date().toISOString(),
            entries: [{
                key: `${hash}::::::`,
                hash,
                fileIdx: null,
                filename: null,
                videoSize: null,
                status: 'uncached',
                verifiedAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 60000).toISOString(),
                source: 'explicit_check'
            }]
        }));
        const persistedNegativeResponse = await requestJson(backendPort, '/downloads', {
            method: 'POST',
            body: {
                metaId: 'tt-rd-history',
                type: 'movie',
                parentTitle: 'Persisted RD Negative',
                addonName: 'Torrentio RD',
                debridProvider: 'realdebrid',
                sourceReadiness: 'unknown',
                infoHash: hash,
                downloadUrl: `http://127.0.0.1:${sourcePort}/rd-history-placeholder.mp4`
            }
        });
        expect(persistedNegativeResponse.statusCode).toBe(409);
        expect(persistedNegativeResponse.body.error).toContain('not cached on Real-Debrid');
        expect(sourceRequests).toEqual([]);
    });

    test('retries a failed record in place and completes the replacement transfer', async () => {
        const createdResponse = await requestJson(backendPort, '/downloads', {
            method: 'POST',
            body: {
                metaId: 'tt-retry-test',
                type: 'movie',
                parentTitle: 'Retry Integration Movie',
                downloadUrl: `http://127.0.0.1:${sourcePort}/movie.mp4`
            }
        });
        expect(createdResponse.statusCode).toBe(201);
        expect(createdResponse.body).toMatchObject({
            status: 'queued',
            attemptCount: 1
        });

        const failedRecord = await waitFor(async () => {
            const response = await requestJson(backendPort, `/downloads/${createdResponse.body.id}`);
            return response.body?.status === 'failed' ? response.body : null;
        });
        expect(failedRecord.error).toContain('HTTP 503');

        sourceShouldFail = false;
        const retryResponse = await requestJson(backendPort, `/downloads/${failedRecord.id}/retry`, { method: 'POST' });
        expect(retryResponse.statusCode).toBe(202);
        expect(retryResponse.body).toMatchObject({
            id: failedRecord.id,
            status: 'queued',
            attemptCount: 2,
            progress: 0,
            error: null
        });

        const completedRecord = await waitFor(async () => {
            const response = await requestJson(backendPort, `/downloads/${failedRecord.id}`);
            return response.body?.status === 'completed' ? response.body : null;
        });
        expect(completedRecord).toMatchObject({
            id: failedRecord.id,
            status: 'completed',
            attemptCount: 2,
            progress: 100,
            error: null
        });
        expect(fs.readFileSync(completedRecord.localPath, 'utf8')).toBe('retry integration media');
    });

    test('deletes completed media from disk together with its saved record', async () => {
        sourceShouldFail = false;
        const createdResponse = await requestJson(backendPort, '/downloads', {
            method: 'POST',
            body: {
                metaId: 'tt-delete-media-test',
                type: 'movie',
                parentTitle: 'Delete Media Integration Movie',
                downloadUrl: `http://127.0.0.1:${sourcePort}/delete-media.mp4`
            }
        });
        expect(createdResponse.statusCode).toBe(201);

        const completedRecord = await waitFor(async () => {
            const response = await requestJson(backendPort, `/downloads/${createdResponse.body.id}`);
            return response.body?.status === 'completed' ? response.body : null;
        });
        expect(fs.existsSync(completedRecord.localPath)).toBe(true);

        await stopChildProcess(backendProcess);
        backendProcess = null;
        await startBackend();
        const restoredRecord = await requestJson(backendPort, `/downloads/${completedRecord.id}`);
        expect(restoredRecord).toMatchObject({
            statusCode: 200,
            body: {
                status: 'completed',
                localFileIdentity: expect.objectContaining({ size: sourceMedia.length })
            }
        });

        const deleteResponse = await requestJson(backendPort, `/downloads/${completedRecord.id}/media`, {
            method: 'DELETE'
        });

        expect(deleteResponse).toMatchObject({
            statusCode: 200,
            body: {
                ok: true,
                id: completedRecord.id,
                status: 'deleted',
                bytesFreed: sourceMedia.length
            }
        });
        expect(deleteResponse.body.deletedFiles).toContain(completedRecord.localPath);
        expect(fs.existsSync(completedRecord.localPath)).toBe(false);
        expect(fs.existsSync(path.dirname(completedRecord.localPath))).toBe(false);
        expect(fs.existsSync(path.join(tempDirectory, 'downloads'))).toBe(true);

        const missingRecord = await requestJson(backendPort, `/downloads/${completedRecord.id}`);
        expect(missingRecord.statusCode).toBe(404);

        const historyResponse = await requestJson(backendPort, '/downloads/history?limit=50');
        expect(historyResponse.statusCode).toBe(200);
        const downloadEvents = historyResponse.body.items.filter(({ downloadId }) => downloadId === completedRecord.id);
        expect(downloadEvents.map(({ eventType }) => eventType)).toEqual(expect.arrayContaining([
            'download_created',
            'download_started',
            'download_completed',
            'media_deletion_requested',
            'media_deleted'
        ]));
        expect(downloadEvents.find(({ eventType }) => eventType === 'media_deleted')).toMatchObject({
            record: {
                media: { title: 'Delete Media Integration Movie' },
                result: { status: 'completed' }
            },
            details: {
                bytesFreed: sourceMedia.length,
                deletedFileCount: 1
            }
        });
        expect(JSON.stringify(downloadEvents)).not.toContain('/delete-media.mp4');

        await stopChildProcess(backendProcess);
        backendProcess = null;
        await startBackend();
        const restoredHistory = await requestJson(backendPort, '/downloads/history?limit=50');
        expect(restoredHistory.statusCode).toBe(200);
        expect(restoredHistory.body.items.filter(({ downloadId }) => downloadId === completedRecord.id)).toEqual(downloadEvents);
    });

    test('refuses destructive deletion when permanent history cannot be written', async () => {
        sourceShouldFail = false;
        const createdResponse = await requestJson(backendPort, '/downloads', {
            method: 'POST',
            body: {
                metaId: 'tt-history-write-safety',
                type: 'movie',
                parentTitle: 'History Write Safety Movie',
                downloadUrl: `http://127.0.0.1:${sourcePort}/history-write-safety.mp4`
            }
        });
        const completedRecord = await waitFor(async () => {
            const response = await requestJson(backendPort, `/downloads/${createdResponse.body.id}`);
            return response.body?.status === 'completed' ? response.body : null;
        });
        await requestJson(backendPort, '/downloads/history');

        const historyPath = path.join(tempDirectory, 'data', 'download-history.ndjson');
        fs.rmSync(historyPath, { force: true });
        fs.mkdirSync(historyPath);
        const deleteResponse = await requestJson(backendPort, `/downloads/${completedRecord.id}/media`, {
            method: 'DELETE'
        });

        expect(deleteResponse).toMatchObject({
            statusCode: 500,
            body: {
                ok: false,
                errorCode: 'DOWNLOAD_HISTORY_WRITE_FAILED'
            }
        });
        expect(fs.existsSync(completedRecord.localPath)).toBe(true);
        await expect(requestJson(backendPort, `/downloads/${completedRecord.id}`)).resolves.toMatchObject({
            statusCode: 200,
            body: { status: 'completed' }
        });
    });

    test('deletes a verified paused partial without touching the download root', async () => {
        sourceShouldFail = false;
        sourceMedia = Buffer.alloc(256 * 1024, 0x42);
        sourceChunkSize = 4096;
        sourceChunkDelayMs = 10;
        const createdResponse = await requestJson(backendPort, '/downloads', {
            method: 'POST',
            body: {
                metaId: 'tt-delete-partial-test',
                type: 'movie',
                parentTitle: 'Delete Partial Integration Movie',
                downloadUrl: `http://127.0.0.1:${sourcePort}/delete-partial.mp4`
            }
        });
        await waitFor(async () => {
            const response = await requestJson(backendPort, `/downloads/${createdResponse.body.id}`);
            return response.body?.status === 'downloading' && response.body.bytesDownloaded > 0;
        });

        const pauseResponse = await requestJson(backendPort, `/downloads/${createdResponse.body.id}/pause`, { method: 'POST' });
        expect(pauseResponse).toMatchObject({
            statusCode: 200,
            body: {
                status: 'paused',
                partialFileIdentity: expect.objectContaining({ size: expect.any(Number) })
            }
        });
        expect(fs.existsSync(pauseResponse.body.partialPath)).toBe(true);

        const deleteResponse = await requestJson(backendPort, `/downloads/${createdResponse.body.id}/media`, {
            method: 'DELETE'
        });
        expect(deleteResponse.statusCode).toBe(200);
        expect(fs.existsSync(pauseResponse.body.partialPath)).toBe(false);
        expect(fs.existsSync(path.join(tempDirectory, 'downloads'))).toBe(true);
    });

    test('never overwrites or claims preexisting final and partial files', async () => {
        sourceShouldFail = false;

        const partialPayload = {
            metaId: 'tt-preexisting-partial',
            type: 'movie',
            parentTitle: 'Preexisting Partial Movie',
            downloadUrl: `http://127.0.0.1:${sourcePort}/preexisting-partial.mp4`
        };
        const partialLocalPath = path.join(tempDirectory, 'downloads', 'Preexisting Partial Movie', 'Preexisting Partial Movie.mp4');
        const preexistingPartialPath = derivePartialPath(partialLocalPath);
        fs.mkdirSync(path.dirname(preexistingPartialPath), { recursive: true });
        fs.writeFileSync(preexistingPartialPath, 'unrelated partial data');

        const partialResponse = await requestJson(backendPort, '/downloads', { method: 'POST', body: partialPayload });
        const failedPartialRecord = await waitFor(async () => {
            const response = await requestJson(backendPort, `/downloads/${partialResponse.body.id}`);
            return response.body?.status === 'failed' ? response.body : null;
        });
        expect(failedPartialRecord.errorCode).toBe('EEXIST');
        expect(failedPartialRecord.partialFileIdentity).toBe(null);
        expect(fs.readFileSync(preexistingPartialPath, 'utf8')).toBe('unrelated partial data');

        const unsafePartialDelete = await requestJson(backendPort, `/downloads/${failedPartialRecord.id}/media`, {
            method: 'DELETE'
        });
        expect(unsafePartialDelete).toMatchObject({
            statusCode: 409,
            body: { errorCode: 'DOWNLOAD_FILE_IDENTITY_UNRECORDED' }
        });
        expect(fs.readFileSync(preexistingPartialPath, 'utf8')).toBe('unrelated partial data');

        const finalPayload = {
            metaId: 'tt-preexisting-final',
            type: 'movie',
            parentTitle: 'Preexisting Final Movie',
            downloadUrl: `http://127.0.0.1:${sourcePort}/preexisting-final.mp4`
        };
        const preexistingFinalPath = path.join(tempDirectory, 'downloads', 'Preexisting Final Movie', 'Preexisting Final Movie.mp4');
        fs.mkdirSync(path.dirname(preexistingFinalPath), { recursive: true });
        fs.writeFileSync(preexistingFinalPath, 'unrelated final data');

        const finalResponse = await requestJson(backendPort, '/downloads', { method: 'POST', body: finalPayload });
        const failedFinalRecord = await waitFor(async () => {
            const response = await requestJson(backendPort, `/downloads/${finalResponse.body.id}`);
            return response.body?.status === 'failed' ? response.body : null;
        });
        expect(failedFinalRecord.errorCode).toBe('DOWNLOAD_DESTINATION_EXISTS');
        expect(failedFinalRecord.partialFileIdentity).toEqual(expect.objectContaining({ size: sourceMedia.length }));
        expect(fs.readFileSync(preexistingFinalPath, 'utf8')).toBe('unrelated final data');

        const safePartialDelete = await requestJson(backendPort, `/downloads/${failedFinalRecord.id}/media`, {
            method: 'DELETE'
        });
        expect(safePartialDelete.statusCode).toBe(200);
        expect(fs.readFileSync(preexistingFinalPath, 'utf8')).toBe('unrelated final data');
        expect(fs.existsSync(derivePartialPath(preexistingFinalPath))).toBe(false);
    });

    test('pauses to a partial file and resumes with a validated byte range', async () => {
        sourceShouldFail = false;
        sourceMedia = Buffer.alloc(512 * 1024, 0x5a);
        sourceChunkSize = 4096;
        sourceChunkDelayMs = 20;

        const createdResponse = await requestJson(backendPort, '/downloads', {
            method: 'POST',
            body: {
                metaId: 'tt-pause-resume-test',
                type: 'movie',
                parentTitle: 'Pause Resume Integration Movie',
                downloadUrl: `http://127.0.0.1:${sourcePort}/pause-resume.mp4`
            }
        });
        const downloadingRecord = await waitFor(async () => {
            const response = await requestJson(backendPort, `/downloads/${createdResponse.body.id}`);
            return response.body?.status === 'downloading' && response.body.bytesDownloaded > 0 ? response.body : null;
        });
        expect(downloadingRecord.partialPath).toMatch(/\.part$/);

        const pauseResponse = await requestJson(backendPort, `/downloads/${createdResponse.body.id}/pause`, { method: 'POST' });
        expect(pauseResponse.statusCode).toBe(200);
        expect(pauseResponse.body).toMatchObject({
            id: createdResponse.body.id,
            status: 'paused',
            speedBytesPerSecond: 0,
            etaSeconds: null
        });
        expect(fs.existsSync(pauseResponse.body.localPath)).toBe(false);
        expect(fs.existsSync(pauseResponse.body.partialPath)).toBe(true);

        const partialSize = fs.statSync(pauseResponse.body.partialPath).size;
        expect(partialSize).toBeGreaterThan(0);
        sourceChunkDelayMs = 1;
        lastRangeHeader = null;
        lastIfRangeHeader = null;

        const resumeResponse = await requestJson(backendPort, `/downloads/${createdResponse.body.id}/resume`, { method: 'POST' });
        expect(resumeResponse.statusCode).toBe(202);
        expect(resumeResponse.body).toMatchObject({
            id: createdResponse.body.id,
            status: 'queued',
            bytesDownloaded: partialSize,
            error: null
        });

        const completedRecord = await waitFor(async () => {
            const response = await requestJson(backendPort, `/downloads/${createdResponse.body.id}`);
            return response.body?.status === 'completed' ? response.body : null;
        });
        expect(lastRangeHeader).toBe(`bytes=${partialSize}-`);
        expect(lastIfRangeHeader).toBe('"integration-v1"');
        expect(completedRecord).toMatchObject({
            status: 'completed',
            bytesDownloaded: sourceMedia.length,
            bytesTotal: sourceMedia.length,
            progress: 100,
            partialPath: null,
            resumeSupported: true
        });
        expect(fs.existsSync(pauseResponse.body.partialPath)).toBe(false);
        expect(fs.readFileSync(completedRecord.localPath)).toEqual(sourceMedia);
    });

    test('fails safely without appending when a source ignores the resume range', async () => {
        sourceShouldFail = false;
        sourceMedia = Buffer.alloc(256 * 1024, 0x3c);
        sourceChunkSize = 4096;
        sourceChunkDelayMs = 20;

        const createdResponse = await requestJson(backendPort, '/downloads', {
            method: 'POST',
            body: {
                metaId: 'tt-unsupported-resume-test',
                type: 'movie',
                parentTitle: 'Unsupported Resume Movie',
                downloadUrl: `http://127.0.0.1:${sourcePort}/unsupported-resume.mp4`
            }
        });
        await waitFor(async () => {
            const response = await requestJson(backendPort, `/downloads/${createdResponse.body.id}`);
            return response.body?.status === 'downloading' && response.body.bytesDownloaded > 0;
        });
        const pauseResponse = await requestJson(backendPort, `/downloads/${createdResponse.body.id}/pause`, { method: 'POST' });
        const partialSize = fs.statSync(pauseResponse.body.partialPath).size;

        sourceSupportsRanges = false;
        sourceChunkDelayMs = 0;
        const resumeResponse = await requestJson(backendPort, `/downloads/${createdResponse.body.id}/resume`, { method: 'POST' });
        expect(resumeResponse.statusCode).toBe(202);

        const failedRecord = await waitFor(async () => {
            const response = await requestJson(backendPort, `/downloads/${createdResponse.body.id}`);
            return response.body?.status === 'failed' ? response.body : null;
        });
        expect(failedRecord).toMatchObject({
            resumeSupported: false
        });
        expect(failedRecord.error).toContain('does not support resuming');
        expect(fs.statSync(failedRecord.partialPath).size).toBe(partialSize);
        expect(fs.existsSync(failedRecord.localPath)).toBe(false);
    });

    test('queues downloads FIFO and hands the slot to waiting work after pause', async () => {
        sourceShouldFail = false;
        sourceMedia = Buffer.alloc(512 * 1024, 0x2a);
        sourceChunkSize = 4096;
        sourceChunkDelayMs = 15;

        const firstResponse = await requestJson(backendPort, '/downloads', {
            method: 'POST',
            body: {
                metaId: 'tt-queue-first',
                type: 'movie',
                parentTitle: 'Queue First Movie',
                downloadUrl: `http://127.0.0.1:${sourcePort}/queue-first.mp4`
            }
        });
        await waitFor(async () => {
            const response = await requestJson(backendPort, `/downloads/${firstResponse.body.id}`);
            return response.body?.status === 'downloading' && response.body.bytesDownloaded > 0;
        });

        const secondResponse = await requestJson(backendPort, '/downloads', {
            method: 'POST',
            body: {
                metaId: 'tt-queue-second',
                type: 'movie',
                parentTitle: 'Queue Second Movie',
                downloadUrl: `http://127.0.0.1:${sourcePort}/queue-second.mp4`
            }
        });
        expect(secondResponse.body.status).toBe('queued');

        const canceledWaitingResponse = await requestJson(backendPort, '/downloads', {
            method: 'POST',
            body: {
                metaId: 'tt-queue-canceled',
                type: 'movie',
                parentTitle: 'Queue Canceled Movie',
                downloadUrl: `http://127.0.0.1:${sourcePort}/queue-canceled.mp4`
            }
        });
        expect(canceledWaitingResponse.body.status).toBe('queued');

        const queuedList = await requestJson(backendPort, '/downloads');
        const queuedItems = queuedList.body.items.filter((record) => record.status === 'queued');
        expect(queuedItems).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: secondResponse.body.id, queuePosition: 1, queueLength: 2 }),
            expect.objectContaining({ id: canceledWaitingResponse.body.id, queuePosition: 2, queueLength: 2 })
        ]));
        expect((await requestJson(backendPort, `/downloads/${secondResponse.body.id}`)).body).toMatchObject({
            queuePosition: 1,
            queueLength: 2
        });

        const rejectActiveReorder = await requestJson(backendPort, `/downloads/${firstResponse.body.id}/queue`, {
            method: 'PATCH',
            body: { position: 1 }
        });
        expect(rejectActiveReorder.statusCode).toBe(409);
        const rejectInvalidPosition = await requestJson(backendPort, `/downloads/${secondResponse.body.id}/queue`, {
            method: 'PATCH',
            body: { position: 3 }
        });
        expect(rejectInvalidPosition.statusCode).toBe(400);

        const movedToTop = await requestJson(backendPort, `/downloads/${canceledWaitingResponse.body.id}/queue`, {
            method: 'PATCH',
            body: { position: 1 }
        });
        expect(movedToTop.body).toMatchObject({ queuePosition: 1, queueLength: 2 });
        expect((await requestJson(backendPort, `/downloads/${secondResponse.body.id}`)).body.queuePosition).toBe(2);

        const movedBack = await requestJson(backendPort, `/downloads/${canceledWaitingResponse.body.id}/queue`, {
            method: 'PATCH',
            body: { position: 2 }
        });
        expect(movedBack.body).toMatchObject({ queuePosition: 2, queueLength: 2 });

        const healthWhileQueued = await requestJson(backendPort, '/health');
        expect(healthWhileQueued.body.downloads).toEqual({ maxConcurrent: 1, active: 1, queued: 2 });
        expect(sourceRequests.some((request) => request.path === '/queue-second.mp4')).toBe(false);
        expect(sourceRequests.some((request) => request.path === '/queue-canceled.mp4')).toBe(false);

        const canceledWaiting = await requestJson(
            backendPort,
            `/downloads/${canceledWaitingResponse.body.id}/cancel`,
            { method: 'POST' }
        );
        expect(canceledWaiting.body.status).toBe('canceled');
        expect((await requestJson(backendPort, '/health')).body.downloads).toEqual({ maxConcurrent: 1, active: 1, queued: 1 });
        expect((await requestJson(backendPort, `/downloads/${secondResponse.body.id}`)).body).toMatchObject({
            queuePosition: 1,
            queueLength: 1
        });

        const pausedFirst = await requestJson(backendPort, `/downloads/${firstResponse.body.id}/pause`, { method: 'POST' });
        expect(pausedFirst.body.status).toBe('paused');

        await waitFor(async () => {
            const response = await requestJson(backendPort, `/downloads/${secondResponse.body.id}`);
            return response.body?.status === 'downloading';
        });

        const resumedFirst = await requestJson(backendPort, `/downloads/${firstResponse.body.id}/resume`, { method: 'POST' });
        expect(resumedFirst.body).toMatchObject({ status: 'queued', queuePosition: 1, queueLength: 1 });
        expect((await requestJson(backendPort, '/health')).body.downloads).toEqual({ maxConcurrent: 1, active: 1, queued: 1 });

        const completedSecond = await waitFor(async () => {
            const response = await requestJson(backendPort, `/downloads/${secondResponse.body.id}`);
            return response.body?.status === 'completed' ? response.body : null;
        });
        const completedFirst = await waitFor(async () => {
            const response = await requestJson(backendPort, `/downloads/${firstResponse.body.id}`);
            return response.body?.status === 'completed' ? response.body : null;
        });

        expect(fs.readFileSync(completedSecond.localPath)).toEqual(sourceMedia);
        expect(fs.readFileSync(completedFirst.localPath)).toEqual(sourceMedia);
        expect(sourceRequests.map((request) => request.path)).toEqual([
            '/queue-first.mp4',
            '/queue-second.mp4',
            '/queue-first.mp4'
        ]);
        expect(sourceRequests[2].range).toMatch(/^bytes=\d+-$/);
        expect(sourceRequests.some((request) => request.path === '/queue-canceled.mp4')).toBe(false);
    });

    test('preserves waiting work across restart while recovering the interrupted transfer as paused', async () => {
        sourceShouldFail = false;
        sourceMedia = Buffer.alloc(512 * 1024, 0x6b);
        sourceChunkSize = 4096;
        sourceChunkDelayMs = 15;

        const activeResponse = await requestJson(backendPort, '/downloads', {
            method: 'POST',
            body: {
                metaId: 'tt-restart-active',
                type: 'movie',
                parentTitle: 'Restart Active Movie',
                downloadUrl: `http://127.0.0.1:${sourcePort}/restart-active.mp4`
            }
        });
        await waitFor(async () => {
            const response = await requestJson(backendPort, `/downloads/${activeResponse.body.id}`);
            return response.body?.status === 'downloading' && response.body.bytesDownloaded > 0;
        });

        const waitingResponse = await requestJson(backendPort, '/downloads', {
            method: 'POST',
            body: {
                metaId: 'tt-restart-waiting',
                type: 'movie',
                parentTitle: 'Restart Waiting Movie',
                downloadUrl: `http://127.0.0.1:${sourcePort}/restart-waiting.mp4`
            }
        });
        expect(waitingResponse.body.status).toBe('queued');
        expect(sourceRequests.some((request) => request.path === '/restart-waiting.mp4')).toBe(false);

        const secondWaitingResponse = await requestJson(backendPort, '/downloads', {
            method: 'POST',
            body: {
                metaId: 'tt-restart-second',
                type: 'movie',
                parentTitle: 'Restart Second Movie',
                downloadUrl: `http://127.0.0.1:${sourcePort}/restart-second.mp4`
            }
        });
        const priorityWaitingResponse = await requestJson(backendPort, '/downloads', {
            method: 'POST',
            body: {
                metaId: 'tt-restart-priority',
                type: 'movie',
                parentTitle: 'Restart Priority Movie',
                downloadUrl: `http://127.0.0.1:${sourcePort}/restart-priority.mp4`
            }
        });
        expect(secondWaitingResponse.body).toMatchObject({ status: 'queued', queuePosition: 2, queueLength: 2 });
        expect(priorityWaitingResponse.body).toMatchObject({ status: 'queued', queuePosition: 3, queueLength: 3 });

        const priorityMoved = await requestJson(backendPort, `/downloads/${priorityWaitingResponse.body.id}/queue`, {
            method: 'PATCH',
            body: { position: 1 }
        });
        expect(priorityMoved.body).toMatchObject({ queuePosition: 1, queueLength: 3 });

        await stopChildProcess(backendProcess);
        backendProcess = null;
        await startBackend();

        const recoveredActive = await waitFor(async () => {
            const response = await requestJson(backendPort, `/downloads/${activeResponse.body.id}`);
            return response.body?.status === 'paused' ? response.body : null;
        });
        expect(recoveredActive.error).toContain('backend stopped');

        const completedWaiting = await waitFor(async () => {
            const response = await requestJson(backendPort, `/downloads/${waitingResponse.body.id}`);
            return response.body?.status === 'completed' ? response.body : null;
        });
        const completedSecondWaiting = await waitFor(async () => {
            const response = await requestJson(backendPort, `/downloads/${secondWaitingResponse.body.id}`);
            return response.body?.status === 'completed' ? response.body : null;
        });
        const completedPriorityWaiting = await waitFor(async () => {
            const response = await requestJson(backendPort, `/downloads/${priorityWaitingResponse.body.id}`);
            return response.body?.status === 'completed' ? response.body : null;
        });
        expect(fs.readFileSync(completedWaiting.localPath)).toEqual(sourceMedia);
        expect(fs.readFileSync(completedSecondWaiting.localPath)).toEqual(sourceMedia);
        expect(fs.readFileSync(completedPriorityWaiting.localPath)).toEqual(sourceMedia);
        expect(sourceRequests.filter((request) => request.path === '/restart-waiting.mp4')).toHaveLength(1);
        expect(sourceRequests.map((request) => request.path)).toEqual([
            '/restart-active.mp4',
            '/restart-priority.mp4',
            '/restart-waiting.mp4',
            '/restart-second.mp4'
        ]);
    });

    test('clears missing shared artifacts and safely resolves duplicate records around a real partial file', async () => {
        await seedDownloadRecords(createSharedCanceledRecords());

        const initialList = await requestJson(backendPort, '/downloads');
        expect(initialList.statusCode).toBe(200);
        expect(initialList.body.items).toHaveLength(3);
        expect(initialList.body.items.map((record) => record.sharedDestinationCount)).toEqual([2, 2, 2]);

        for (const record of initialList.body.items) {
            const deletion = await requestJson(backendPort, `/downloads/${record.id}/media`, { method: 'DELETE' });
            expect(deletion).toMatchObject({
                statusCode: 200,
                body: {
                    ok: true,
                    id: record.id,
                    status: 'deleted',
                    deletedFiles: []
                }
            });
        }
        expect((await requestJson(backendPort, '/downloads')).body.items).toEqual([]);

        const partialPath = derivePartialPath(path.join(
            tempDirectory,
            'downloads',
            'Shared Canceled Movie',
            'Shared Canceled Movie.mp4'
        ));
        fs.mkdirSync(path.dirname(partialPath), { recursive: true });
        fs.writeFileSync(partialPath, 'real shared partial bytes');
        const identity = createFileIdentity(fs.lstatSync(partialPath));
        await seedDownloadRecords(createSharedCanceledRecords(identity));

        const blockedDeletion = await requestJson(backendPort, '/downloads/shared-canceled-1/media', { method: 'DELETE' });
        expect(blockedDeletion).toMatchObject({
            statusCode: 409,
            body: {
                errorCode: 'DOWNLOAD_MEDIA_SHARED_RECORDS',
                sharedRecordIds: ['shared-canceled-2', 'shared-canceled-3']
            }
        });
        expect(fs.readFileSync(partialPath, 'utf8')).toBe('real shared partial bytes');

        const firstDuplicateRemoval = await requestJson(backendPort, '/downloads/shared-canceled-1', { method: 'DELETE' });
        expect(firstDuplicateRemoval).toMatchObject({
            statusCode: 200,
            body: {
                status: 'deleted',
                remainingSharedRecordIds: ['shared-canceled-2', 'shared-canceled-3']
            }
        });
        const secondDuplicateRemoval = await requestJson(backendPort, '/downloads/shared-canceled-2', { method: 'DELETE' });
        expect(secondDuplicateRemoval).toMatchObject({
            statusCode: 200,
            body: {
                status: 'deleted',
                remainingSharedRecordIds: ['shared-canceled-3']
            }
        });

        const lastRecord = await requestJson(backendPort, '/downloads/shared-canceled-3');
        expect(lastRecord.body.sharedDestinationCount).toBe(0);
        const unsafeLastRecordRemoval = await requestJson(backendPort, '/downloads/shared-canceled-3', { method: 'DELETE' });
        expect(unsafeLastRecordRemoval).toMatchObject({
            statusCode: 409,
            body: { errorCode: 'DOWNLOAD_PARTIAL_DATA_REQUIRES_DELETE' }
        });
        expect(fs.existsSync(partialPath)).toBe(true);

        const finalDeletion = await requestJson(backendPort, '/downloads/shared-canceled-3/media', { method: 'DELETE' });
        expect(finalDeletion).toMatchObject({
            statusCode: 200,
            body: {
                status: 'deleted',
                deletedFiles: [partialPath],
                bytesFreed: Buffer.byteLength('real shared partial bytes')
            }
        });
        expect(fs.existsSync(partialPath)).toBe(false);
        expect((await requestJson(backendPort, '/downloads')).body.items).toEqual([]);
    });

    test('updates concurrency at runtime and preserves the in-app setting across restart', async () => {
        const initialSettings = await requestJson(backendPort, '/settings');
        expect(initialSettings.statusCode).toBe(200);
        expect(initialSettings.body.downloads).toEqual({
            maxConcurrentDownloads: 1,
            minAllowedConcurrentDownloads: 1,
            maxAllowedConcurrentDownloads: null,
            unlimitedValue: 'unlimited'
        });

        sourceShouldFail = false;
        sourceMedia = Buffer.alloc(512 * 1024, 0x4d);
        sourceChunkSize = 4096;
        sourceChunkDelayMs = 15;

        const firstResponse = await requestJson(backendPort, '/downloads', {
            method: 'POST',
            body: {
                metaId: 'tt-settings-first',
                type: 'movie',
                parentTitle: 'Settings First Movie',
                downloadUrl: `http://127.0.0.1:${sourcePort}/settings-first.mp4`
            }
        });
        await waitFor(async () => {
            const response = await requestJson(backendPort, `/downloads/${firstResponse.body.id}`);
            return response.body?.status === 'downloading' && response.body.bytesDownloaded > 0;
        });

        const secondResponse = await requestJson(backendPort, '/downloads', {
            method: 'POST',
            body: {
                metaId: 'tt-settings-second',
                type: 'movie',
                parentTitle: 'Settings Second Movie',
                downloadUrl: `http://127.0.0.1:${sourcePort}/settings-second.mp4`
            }
        });
        expect(secondResponse.body.status).toBe('queued');

        const updatedSettings = await requestJson(backendPort, '/settings', {
            method: 'PATCH',
            headers: { Origin: 'https://localhost:8081' },
            body: { downloads: { maxConcurrentDownloads: 2 } }
        });
        expect(updatedSettings.statusCode).toBe(200);
        expect(updatedSettings.body.downloads.maxConcurrentDownloads).toBe(2);

        await waitFor(async () => {
            const response = await requestJson(backendPort, `/downloads/${secondResponse.body.id}`);
            return response.body?.status === 'downloading';
        });
        expect((await requestJson(backendPort, '/health')).body.downloads).toMatchObject({
            maxConcurrent: 2,
            active: 2
        });

        const customSettings = await requestJson(backendPort, '/settings', {
            method: 'PATCH',
            body: { downloads: { maxConcurrentDownloads: 128 } }
        });
        expect(customSettings.statusCode).toBe(200);
        expect(customSettings.body.downloads.maxConcurrentDownloads).toBe(128);

        const unlimitedSettings = await requestJson(backendPort, '/settings', {
            method: 'PATCH',
            body: { downloads: { maxConcurrentDownloads: 'unlimited' } }
        });
        expect(unlimitedSettings.statusCode).toBe(200);
        expect(unlimitedSettings.body.downloads.maxConcurrentDownloads).toBe('unlimited');

        const invalidSettings = await requestJson(backendPort, '/settings', {
            method: 'PATCH',
            body: { downloads: { maxConcurrentDownloads: 0 } }
        });
        expect(invalidSettings.statusCode).toBe(400);

        await stopChildProcess(backendProcess);
        backendProcess = null;
        await startBackend();

        const restoredSettings = await requestJson(backendPort, '/settings');
        expect(restoredSettings.body.downloads.maxConcurrentDownloads).toBe('unlimited');
        expect((await requestJson(backendPort, '/health')).body.downloads.maxConcurrent).toBe('unlimited');
    });
});
