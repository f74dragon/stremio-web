/* global test, expect */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { fork } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { BackendController } = require('../desktop/backend-controller.cjs');
const { TOKEN_HEADER, DESKTOP_ORIGIN, assertNoLegacyBackend } = require('../local-backend/managedAccess');
const { acquireDataRootLock } = require('../local-backend/dataRootLock');
const { createWorkTracker } = require('../local-backend/workTracker');
const { createBackendSettings, writeBackendSettings } = require('../local-backend/backendSettingsStore');
const isolatedRuntime = ['--require', path.join(__dirname, 'fixtures/isolatedManagedBackend.cjs')];

const createController = (dataDirectory) => new BackendController({
    dataDirectory,
    fork: (entry, options) => fork(entry, [], { ...options, execArgv: isolatedRuntime, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
});
const request = async (controller, route, options = {}) => {
    const response = await fetch(`${controller.connection.baseUrl}${route}`, {
        ...options, headers: { [TOKEN_HEADER]: controller.connection.token, Origin: DESKTOP_ORIGIN, ...options.headers }
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return body;
};
const until = async (operation, predicate, timeout = 10000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const value = await operation();
        if (predicate(value)) return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Timed out waiting for backend state');
};

test('data folder lock rejects another writer and releases without a stale file', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-stremio-lock-'));
    let lock;
    try {
        lock = await acquireDataRootLock(root);
        await expect(acquireDataRootLock(path.join(root, '.'))).rejects.toMatchObject({ code: 'DATA_ROOT_IN_USE' });
        await lock.release();
        lock = await acquireDataRootLock(root);
        expect(fs.readdirSync(root)).toEqual([]);
    } finally {
        await lock?.release();
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('owned service authenticates, refuses a second writer, survives restart and recovers a crash', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-stremio-owned-'));
    const owner = createController(root);
    const duplicate = createController(root);
    try {
        const connection = await owner.start();
        expect((await fetch(`${connection.baseUrl}/health`)).status).toBe(401);
        expect((await fetch(`${connection.baseUrl}/health`, { headers: { [TOKEN_HEADER]: connection.token, Origin: 'https://example.com' } })).status).toBe(403);
        expect((await request(owner, '/health')).instanceId).toBe(connection.instanceId);
        await expect(duplicate.start()).rejects.toMatchObject({ code: 'DATA_ROOT_IN_USE' });
        await duplicate.stop();
        expect((await request(owner, '/health')).ok).toBe(true);
        await request(owner, '/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ downloads: { maxConcurrentDownloads: 2 } }) });
        expect(await owner.stop()).toEqual({ forced: false });
        await owner.start();
        expect((await request(owner, '/settings')).downloads.maxConcurrentDownloads).toBe(2);
        expect(owner.connection.instanceId).not.toBe(connection.instanceId);
        const exited = owner.exited;
        owner.child.kill();
        await exited;
        expect(owner.phase).toBe('failed');
        await owner.start();
        expect((await request(owner, '/health')).ok).toBe(true);
    } finally {
        await duplicate.stop();
        await owner.stop();
        fs.rmSync(root, { recursive: true, force: true });
    }
}, 30000);

test('quit pauses a real transfer, restart resumes its partial bytes, and history is preserved', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-stremio-transfer-'));
    const contents = Buffer.alloc(1024 * 1024, 73);
    let rangeUsed = false;
    const source = http.createServer((req, res) => {
        const offset = Number(/^bytes=(\d+)-$/.exec(req.headers.range || '')?.[1] || 0);
        rangeUsed ||= offset > 0;
        res.writeHead(offset ? 206 : 200, {
            'Content-Length': contents.length - offset, 'Accept-Ranges': 'bytes', ETag: '"fixture-v1"',
            ...(offset ? { 'Content-Range': `bytes ${offset}-${contents.length - 1}/${contents.length}` } : {})
        });
        let cursor = offset;
        const timer = setInterval(() => {
            const end = Math.min(cursor + 32768, contents.length);
            res.write(contents.subarray(cursor, end));
            cursor = end;
            if (cursor === contents.length) { clearInterval(timer); res.end(); }
        }, 35);
        res.on('close', () => clearInterval(timer));
    });
    await new Promise((resolve) => source.listen(0, '127.0.0.1', resolve));
    const controller = new BackendController({
        dataDirectory: root,
        fork: (entry, options) => fork(entry, [], {
            ...options, env: { ...options.env, CUSTOM_STREMIO_DOWNLOAD_DIR: path.join(root, 'files') },
            execArgv: isolatedRuntime, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc']
        })
    });
    try {
        await controller.start();
        await request(controller, '/downloads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            downloadUrl: `http://127.0.0.1:${source.address().port}/fixture.bin`, fileName: 'fixture.bin', metaId: 'fixture', videoTitle: 'Launcher test'
        }) });
        await until(() => request(controller, '/downloads'), (value) => value.items[0]?.bytesDownloaded > 0);
        expect(await controller.stop()).toEqual({ forced: false });
        const saved = JSON.parse(fs.readFileSync(path.join(root, 'download-records.json'), 'utf8')).records[0];
        expect(saved.status).toBe('paused');
        expect(fs.statSync(saved.partialPath).size).toBeGreaterThan(0);
        // Keep every artifact inside the test directory, even if the environment contract changes.
        expect(path.relative(root, saved.partialPath).startsWith('..')).toBe(false);
        await controller.start();
        await request(controller, `/downloads/${saved.id}/resume`, { method: 'POST' });
        const completed = await until(() => request(controller, '/downloads'), (value) => value.items[0]?.status === 'completed');
        expect(rangeUsed).toBe(true);
        expect(fs.readFileSync(completed.items[0].localPath)).toEqual(contents);
        expect(fs.readFileSync(path.join(root, 'download-history.ndjson'), 'utf8')).toContain(saved.id);
    } finally {
        await controller.stop();
        source.closeAllConnections();
        await new Promise((resolve) => source.close(resolve));
        fs.rmSync(root, { recursive: true, force: true });
    }
}, 30000);

test('shutdown waits for asynchronous work even when the client disconnects', async () => {
    const tracker = createWorkTracker();
    let release;
    let drained = false;
    const work = tracker.run(() => new Promise((resolve) => { release = resolve; }));
    await Promise.resolve();
    const idle = tracker.waitForIdle().then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await work;
    await idle;
    expect(drained).toBe(true);
});

test('failed local recovery preserves unsupported records and releases ownership', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-stremio-invalid-'));
    const file = path.join(root, 'download-records.json');
    const original = '{"version":999,"records":[{"id":"future"}]}';
    fs.writeFileSync(file, original);
    const controller = createController(root);
    try {
        await expect(controller.start()).rejects.toMatchObject({ code: 'BACKEND_START_FAILED' });
        await controller.stop();
        expect(fs.readFileSync(file, 'utf8')).toBe(original);
        fs.writeFileSync(file, '{"version":1,"records":[]}');
        await controller.start();
        expect((await request(controller, '/downloads')).items).toEqual([]);
    } finally {
        await controller.stop();
        fs.rmSync(root, { recursive: true, force: true });
    }
}, 20000);

test('legacy probe rejects the terminal service and ignores unrelated or oversized responses', async () => {
    let mode = 'legacy';
    const server = http.createServer((_req, res) => {
        res.end(mode === 'legacy' ? JSON.stringify({ service: 'custom-stremio-local-backend', version: 'dev' }) : mode === 'large' ? 'x'.repeat(20000) : '{}');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        await expect(assertNoLegacyBackend(baseUrl)).rejects.toMatchObject({ code: 'LEGACY_BACKEND_RUNNING' });
        mode = 'unrelated';
        await expect(assertNoLegacyBackend(baseUrl)).resolves.toBeUndefined();
        mode = 'large';
        await expect(assertNoLegacyBackend(baseUrl)).resolves.toBeUndefined();
    } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('Quit during startup exits only the newly owned child without starting its service', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-stremio-cancel-'));
    const controller = createController(root);
    try {
        const startup = controller.start().catch((error) => error);
        expect(await controller.stop()).toEqual({ forced: false });
        expect((await startup).code).toBe('BACKEND_EXITED');
        expect(controller.child).toBeNull();
        expect(fs.readdirSync(root)).toEqual([]);
    } finally { await controller.stop(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('unresponsive shutdown forces only the owned child after its grace period', async () => {
    const child = new EventEmitter();
    child.pid = 123;
    child.postMessage = () => { /* Deliberately unresponsive child. */ };
    let killed = false;
    child.kill = () => { killed = true; child.emit('exit', 1); };
    const controller = new BackendController({ fork: () => child, dataDirectory: 'unused', startupTimeout: 1000, shutdownTimeout: 10 });
    const startup = controller.start().catch((error) => error);
    const result = await controller.stop();
    await startup;
    expect(result.forced).toBe(true);
    expect(killed).toBe(true);
    expect(controller.child).toBeNull();
});

test('slow offline provider recovery cannot delay local readiness or lose saved state on Quit', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-stremio-offline-'));
    let started = false;
    let finished = false;
    const settings = createBackendSettings(2, null, null, {
        clientId: 'synthetic', clientSecret: 'synthetic', accessToken: 'synthetic', refreshToken: 'synthetic', tokenExpiresAt: '2020-01-01T00:00:00Z'
    });
    await writeBackendSettings(path.join(root, 'backend-settings.json'), settings);
    const controller = new BackendController({ dataDirectory: root, fork: (entry, options) => {
        const child = fork(entry, [], { ...options, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
            execArgv: ['--require', path.join(__dirname, 'fixtures/slowProviderBackend.cjs')] });
        child.on('message', (message) => {
            if (message.type === 'test-provider-started') started = true;
            if (message.type === 'test-provider-finished') finished = true;
        });
        return child;
    } });
    try {
        await controller.start();
        await until(async () => started, Boolean);
        expect(finished).toBe(false);
        expect((await request(controller, '/health')).ok).toBe(true);
        expect(await controller.stop()).toEqual({ forced: false });
        expect(finished).toBe(true);
        expect(JSON.parse(fs.readFileSync(path.join(root, 'backend-settings.json'), 'utf8')).settings.downloads.maxConcurrentDownloads).toBe(2);
    } finally { await controller.stop(); fs.rmSync(root, { recursive: true, force: true }); }
}, 15000);
