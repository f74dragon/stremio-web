/* global jest, describe, beforeEach, afterEach, test, expect */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

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

const requestJson = (port, requestPath, { method = 'GET', body } = {}) => new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const request = http.request({
        host: '127.0.0.1',
        port,
        path: requestPath,
        method,
        headers: payload === null ? {} : {
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
        sourceServer = http.createServer((request, response) => {
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

        backendProcess = spawn(process.execPath, [path.join(__dirname, '..', 'local-backend', 'server.js')], {
            cwd: path.join(__dirname, '..'),
            env: {
                ...process.env,
                PORT: String(backendPort),
                CUSTOM_STREMIO_DATA_DIR: path.join(tempDirectory, 'data'),
                CUSTOM_STREMIO_DOWNLOAD_DIR: path.join(tempDirectory, 'downloads')
            },
            stdio: 'ignore',
            windowsHide: true
        });

        await waitFor(async () => {
            const health = await requestJson(backendPort, '/health');
            return health.statusCode === 200;
        });
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
});
