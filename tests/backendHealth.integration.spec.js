/* global test, expect */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const { checkDesktopBackendCompatibility } = require('../desktop/backend-compatibility.cjs');
const { version } = require('../local-backend/package.json');

const findTestPort = () => new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        server.close(() => resolve(port));
    });
});

const readHealth = (port) => new Promise((resolve, reject) => {
    const request = http.get(`http://127.0.0.1:${port}/health`, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.once('error', reject);
        response.once('end', () => {
            try {
                expect(response.statusCode).toBe(200);
                resolve(JSON.parse(body));
            } catch (error) {
                reject(error);
            }
        });
    });
    request.once('error', reject);
    request.setTimeout(3000, () => request.destroy(new Error('Test health request timed out')));
});

test('a fresh isolated backend serves the release handshake and existing scheduler health', async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-stremio-health-'));
    let child;
    let closed;
    try {
        const port = await findTestPort();
        child = spawn(process.execPath, [path.join(__dirname, '../local-backend/server.js')], {
            cwd: path.join(__dirname, '..'),
            env: { ...process.env, PORT: String(port), CUSTOM_STREMIO_DATA_DIR: fixtureRoot },
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        closed = new Promise((resolve) => child.once('close', resolve));
        let startupTimeout;
        try {
            await new Promise((resolve, reject) => {
                let output = '';
                startupTimeout = setTimeout(() => reject(new Error(`Test backend startup timed out: ${output}`)), 10000);
                const collect = (chunk) => {
                    output = (output + chunk.toString()).slice(-4000);
                    if (output.includes(`listening on http://127.0.0.1:${port}`)) resolve();
                };
                child.stdout.on('data', collect);
                child.stderr.on('data', collect);
                child.once('error', reject);
                child.once('exit', (code) => reject(new Error(`Test backend exited (${code}): ${output}`)));
            });
        } finally {
            clearTimeout(startupTimeout);
        }
        const health = await readHealth(port);
        expect(health.version).toBe(version);
        expect(checkDesktopBackendCompatibility(health)).toEqual({ compatible: true, reason: null });
        expect(health.downloads).toEqual({ maxConcurrent: expect.any(Number), active: 0, queued: 0 });
        expect(health.time).toEqual(expect.any(String));
    } finally {
        if (child && child.exitCode === null && child.signalCode === null) child.kill();
        if (closed) await closed;
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
}, 20000);
