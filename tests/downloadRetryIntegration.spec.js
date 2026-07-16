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

describe('download retry API integration', () => {
    let tempDirectory;
    let backendProcess;
    let backendPort;
    let sourceServer;
    let sourcePort;
    let sourceShouldFail;

    beforeEach(async () => {
        tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-stremio-retry-api-'));
        backendPort = await getFreePort();
        sourcePort = await getFreePort();
        sourceShouldFail = true;
        sourceServer = http.createServer((request, response) => {
            if (sourceShouldFail) {
                response.writeHead(503, { 'Content-Type': 'text/plain' });
                response.end('temporarily unavailable');
                return;
            }

            const media = Buffer.from('retry integration media');
            response.writeHead(200, {
                'Content-Type': 'video/mp4',
                'Content-Length': media.length
            });
            response.end(media);
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
            await new Promise((resolve) => sourceServer.close(resolve));
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
});
