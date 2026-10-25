// Actual installed A -> failed B/restore -> verified B, with synthetic profiles only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const { inspect, runSetup, connect, waitFor } = require('./test-windows-installer.cjs');
const { createBundle } = require('./build-personal-update.cjs');
const { signManifest } = require('../desktop/personal-update.cjs');
const { DownloadHistoryStore } = require('../local-backend/downloadHistoryStore');
const desktop = require('../desktop/package.json');
const root = path.resolve(__dirname, '..');
const qa = path.join(root, '.core-build/update-qa');
const stage = path.join(root, '.core-build/desktop-app');
const run = (modulePath, args) => execFileSync(process.execPath, [require.resolve(modulePath), ...args], { cwd: root, windowsHide: true, stdio: 'inherit' });
const port = () => new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolve(value)); });
});
const versions = [desktop.version, desktop.version.replace(/(\d+)$/, (number) => Number(number) + 1)];
const main = async () => {
    assert.equal(process.platform, 'win32');
    const before = inspect();
    assert.equal(before.UserEntries.length + before.MachineEntries.length + before.Shortcuts.length, 0, 'Refusing to replace a real installation or shortcuts');
    fs.mkdirSync(qa, { recursive: true });
    const pair = crypto.generateKeyPairSync('ed25519');
    // Test identity never replaces the checked-in public key or personal private key.
    run(path.join(__dirname, 'build-desktop.cjs'), ['--skip-ui']);
    const lifetime = path.join(qa, 'helper-lifetime.json');
    fs.rmSync(lifetime, { force: true });
    const helperEnv = { ...process.env };
    delete helperEnv.ELECTRON_RUN_AS_NODE; delete helperEnv.NODE_OPTIONS;
    execFileSync(require('electron'), [path.join(__dirname, 'verify-update-helper.cjs')], { env: helperEnv, windowsHide: true, stdio: 'inherit', timeout: 20000 });
    await waitFor(async () => fs.existsSync(lifetime), Boolean);
    assert.equal(JSON.parse(fs.readFileSync(lifetime, 'utf8')).passed, true, 'Actual helper survives Electron parent exit');
    fs.writeFileSync(path.join(stage, 'desktop/update-public-key.pem'), pair.publicKey.export({ type: 'spki', format: 'pem' }));
    const artifacts = [];
    for (const [index, version] of versions.entries()) {
        for (const filename of ['package.json', 'desktop/package.json']) {
            const location = path.join(stage, filename);
            const value = JSON.parse(fs.readFileSync(location, 'utf8'));
            fs.writeFileSync(location, JSON.stringify({ ...value, version }, null, 2));
        }
        const location = path.join(stage, 'build-info.json');
        const info = JSON.parse(fs.readFileSync(location, 'utf8'));
        fs.writeFileSync(location, JSON.stringify({ ...info, desktopVersion: version, testFixture: true }, null, 2));
        const directory = path.join(qa, 'artifacts', index === 0 ? 'A' : 'B');
        run('electron-builder/cli.js', ['--win', '--x64', '--publish', 'never', '--config', 'desktop/electron-builder.cjs', `--config.directories.output=${directory}`]);
        artifacts.push({ directory, installer: path.join(directory, `Custom-Stremio-${version}-windows-x64-setup.exe`), version });
    }
    const bundle = await createBundle({ ...artifacts[1], source: 'a'.repeat(40), privateKey: pair.privateKey });
    const valid = JSON.parse(fs.readFileSync(bundle, 'utf8'));
    const badValue = JSON.parse(Buffer.from(valid.payload, 'base64').toString('utf8'));
    badValue.installed.exeSha256 = '0'.repeat(64);
    const badBundle = path.join(artifacts[1].directory, 'test-failed-verification.stremio-update.json');
    fs.writeFileSync(badBundle, JSON.stringify(signManifest(badValue, pair.privateKey)));
    const fixture = fs.mkdtempSync(path.join(qa, 'run-'));
    const installation = path.join(fixture, 'Installed App');
    const data = path.join(fixture, 'data');
    const media = path.join(fixture, 'media/kept.mp4');
    fs.mkdirSync(path.dirname(media), { recursive: true });
    fs.mkdirSync(data);
    fs.writeFileSync(media, 'Personal updater synthetic media');
    fs.writeFileSync(path.join(data, 'download-records.json'), JSON.stringify({ version: 1, records: [{ id: 'update-fixture', status: 'completed', metaId: 'update-fixture', videoId: 'update-fixture', type: 'movie', videoTitle: 'Update fixture', parentTitle: 'Update fixture', localPath: media }] }));
    const history = new DownloadHistoryStore({ filePath: path.join(data, 'download-history.ndjson') });
    await history.append({ eventType: 'download_completed', record: { id: 'history-fixture', status: 'completed', localPath: media }, occurredAt: '2026-01-01T00:00:00Z' });
    fs.writeFileSync(path.join(data, 'playback-progress.json'), JSON.stringify({ version: 1, records: [{ contentKey: 'movie:update-fixture', downloadId: 'update-fixture', localPath: media, positionMs: 30000, durationMs: 120000, state: 'paused', lastObservedAt: '2026-01-01T00:00:00Z' }] }));
    const personalState = '{"syntheticProviderState":"retained"}';
    fs.writeFileSync(path.join(data, 'personal-state-fixture.json'), personalState);
    const contents = Buffer.alloc(512 * 1024, 73);
    let rangeUsed = false;
    const source = http.createServer((request, response) => {
        const offset = Number(/^bytes=(\d+)-$/.exec(request.headers.range || '')?.[1] || 0);
        rangeUsed ||= offset > 0;
        response.writeHead(offset ? 206 : 200, { 'Content-Length': contents.length - offset, 'Accept-Ranges': 'bytes', ETag: '"personal-update-fixture"', ...(offset ? { 'Content-Range': `bytes ${offset}-${contents.length - 1}/${contents.length}` } : {}) });
        let cursor = offset;
        const timer = setInterval(() => {
            const end = Math.min(cursor + 8192, contents.length);
            response.write(contents.subarray(cursor, end)); cursor = end;
            if (cursor === contents.length) { clearInterval(timer); response.end(); }
        }, 100);
        response.on('close', () => clearInterval(timer));
    });
    const executable = path.join(installation, 'custom-stremio.exe');
    const uninstaller = path.join(installation, 'Uninstall custom-stremio.exe');
    const debugPort = await port();
    const inspectorPort = await port();
    const flags = [`--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1', `--inspect=${inspectorPort}`, '--disable-gpu'];
    const report = { fixture, from: versions[0], to: versions[1] };
    let runtime;
    let updates;
    let inspector;
    let launched;
    const openRuntime = async (expectedVersion) => {
        const target = await waitFor(async () => {
            try { return (await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json())).find((page) => page.type === 'page' && page.url === 'custom-stremio://app/'); }
            catch { return null; }
        }, Boolean, 90000);
        runtime = await connect(target.webSocketDebuggerUrl);
        await waitFor(() => runtime.evaluate('!!window.core && !!window.customStremioDesktop?.backendBaseUrl'), Boolean, 25000);
        assert.equal(await runtime.evaluate('window.customStremioDesktop.version'), expectedVersion);
        assert.equal((await runtime.evaluate('fetch(window.customStremioDesktop.backendBaseUrl + "/health").then(r=>r.json())')).ok, true);
        return runtime;
    };
    const openUpdate = async (filename) => {
        const target = await fetch(`http://127.0.0.1:${inspectorPort}/json/list`).then((r) => r.json());
        inspector = await connect(target[0].webSocketDebuggerUrl);
        // Native dialog adapter selects only our synthetic fixture; production IPC has no path argument.
        await inspector.evaluate(`process.mainModule.require('electron').dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(filename)}] }); process.mainModule.require('electron').dialog.showMessageBox = async () => ({ response: 0 }); true`);
        await runtime.evaluate('window.customStremioDesktop.openUpdates()');
        const page = await waitFor(async () => (await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json())).find((item) => item.url === 'custom-stremio://app/desktop-updates.html'), Boolean);
        updates = await connect(page.webSocketDebuggerUrl);
        await waitFor(() => updates.evaluate('!!window.customStremioDesktop'), Boolean);
        await updates.evaluate('window.customStremioDesktop.chooseUpdate()');
        const state = await waitFor(() => updates.evaluate('window.customStremioDesktop.getUpdateStatus()'), (state) => ['ready', 'error'].includes(state.phase), 25000);
        assert.equal(state.phase, 'ready', JSON.stringify(state));
    };
    const pendingDirectory = () => {
        const pending = JSON.parse(fs.readFileSync(path.join(data, 'updates/pending.json'), 'utf8'));
        return path.join(data, 'updates', pending.id);
    };
    const restart = async (expectedPhase) => {
        const previous = await runtime.evaluate('window.customStremioDesktop.backendBaseUrl');
        const pending = pendingDirectory();
        inspector.close(); inspector = null;
        await updates.evaluate('document.getElementById("install").click()');
        await waitFor(async () => {
            try { return JSON.parse(fs.readFileSync(path.join(pending, 'result.json'), 'utf8')); }
            catch {
                const state = await updates.evaluate('window.customStremioDesktop.getUpdateStatus()').catch(() => null);
                if (state?.phase === 'error') throw new Error(`Update did not start: ${state.code}`);
                return null;
            }
        }, (result) => result?.phase === expectedPhase || result?.phase === 'error', 180000).then((result) => assert.equal(result.phase, expectedPhase, JSON.stringify(result)));
        await assert.rejects(fetch(`${previous}/health`, { signal: AbortSignal.timeout(2000) }));
        updates.close(); runtime.close();
        updates = null; inspector = null; runtime = null;
        return pending;
    };
    try {
        await new Promise((resolve) => source.listen(0, '127.0.0.1', resolve));
        assert.equal(runSetup(artifacts[0].installer, ['/S', `/D=${installation}`]), 0);
        const env = { ...process.env, PATH: '', CUSTOM_STREMIO_DATA_DIR: data, CUSTOM_STREMIO_DOWNLOAD_DIR: path.dirname(media) };
        delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.NODE_PATH;
        launched = spawn(executable, flags, { env, windowsHide: true, stdio: 'ignore', cwd: installation });
        await openRuntime(versions[0]);
        await runtime.evaluate('localStorage.setItem("personal-update-login-fixture", "retained")');
        await runtime.evaluate('fetch(window.customStremioDesktop.backendBaseUrl + "/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ downloads: { maxConcurrentDownloads: 2 } }) }).then(r=>r.json())');
        await openUpdate(badBundle);
        await runtime.evaluate(`fetch(window.customStremioDesktop.backendBaseUrl + '/downloads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ downloadUrl: 'http://127.0.0.1:${source.address().port}/resume.bin', fileName: 'resume.bin', metaId: 'resume-fixture', videoTitle: 'Resume fixture' }) }).then(r=>r.json())`);
        await waitFor(() => runtime.evaluate('fetch(window.customStremioDesktop.backendBaseUrl + "/downloads").then(r=>r.json())'), (state) => state.items.some((item) => item.metaId === 'resume-fixture' && item.bytesDownloaded > 0));
        const capture = await updates.command('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(qa, 'ready-update.png'), Buffer.from(capture.data, 'base64'));
        const failed = await restart('rolled-back');
        await openRuntime(versions[0]);
        assert.equal(inspect().UserEntries[0].DisplayVersion, versions[0], 'Failed update restores registration');
        assert.equal(await runtime.evaluate('localStorage.getItem("personal-update-login-fixture")'), 'retained');
        const paused = (await runtime.evaluate('fetch(window.customStremioDesktop.backendBaseUrl + "/downloads").then(r=>r.json())')).items.find((item) => item.metaId === 'resume-fixture');
        assert.equal(paused.status, 'paused');
        const partial = fs.readFileSync(paused.partialPath);
        assert(partial.length > 0);
        report.failedUpdateRestored = true;
        report.oldBackendStopped = true;
        await openUpdate(bundle);
        const successful = await restart('complete');
        await openRuntime(versions[1]);
        assert.equal(inspect().UserEntries[0].DisplayVersion, versions[1]);
        assert.equal(await runtime.evaluate('localStorage.getItem("personal-update-login-fixture")'), 'retained');
        assert.equal((await runtime.evaluate('fetch(window.customStremioDesktop.backendBaseUrl + "/settings").then(r=>r.json())')).downloads.maxConcurrentDownloads, 2);
        const records = (await runtime.evaluate('fetch(window.customStremioDesktop.backendBaseUrl + "/downloads").then(r=>r.json())')).items;
        assert(records.some((item) => item.id === 'update-fixture'));
        assert.equal(records.find((item) => item.id === paused.id).status, 'paused');
        assert.deepEqual(fs.readFileSync(paused.partialPath), partial);
        assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'playback-progress.json'), 'utf8')).records[0].positionMs, 30000);
        assert.equal(fs.readFileSync(path.join(data, 'personal-state-fixture.json'), 'utf8'), personalState);
        await runtime.evaluate(`fetch(window.customStremioDesktop.backendBaseUrl + '/downloads/${paused.id}/resume', { method: 'POST' }).then(r=>r.json())`);
        const completed = await waitFor(() => runtime.evaluate('fetch(window.customStremioDesktop.backendBaseUrl + "/downloads").then(r=>r.json())'), (state) => state.items.some((item) => item.id === paused.id && item.status === 'completed'), 15000);
        assert(rangeUsed, 'Resumed transfer requests the retained partial byte offset');
        assert.deepEqual(fs.readFileSync(completed.items.find((item) => item.id === paused.id).localPath), contents);
        assert.equal(fs.readFileSync(media, 'utf8'), 'Personal updater synthetic media');
        assert.equal(fs.readFileSync(path.join(data, 'download-history.ndjson'), 'utf8').includes('history-fixture'), true);
        const backups = fs.readdirSync(path.join(data, 'release-backups'));
        assert.equal(backups.length, 2);
        for (const directory of [failed, successful]) assert(fs.existsSync(path.join(directory, 'previous-app/resources/app.asar')));
        report.installedUpgrade = true;
        report.profileSettingsRecordsHistoryMediaRetained = true;
        report.backupsRetained = true;
        report.activeTransferPausedAndResumed = true;
        report.playbackProgressAndOpaqueStateRetained = true;
        await runtime.evaluate('window.customStremioDesktop.quit()').catch(() => { /* Page can close before replying. */ });
        runtime.close(); runtime = null;
        await waitFor(async () => runSetup(uninstaller, ['/S']), (code) => code === 0, 30000);
        await waitFor(async () => inspect().UserEntries.length === 0, Boolean, 20000);
        assert.equal(inspect().Shortcuts.length, 0);
        report.passed = true;
    } catch (error) { report.error = error.stack; throw error; }
    finally {
        if (updates) updates.close();
        if (inspector) inspector.close();
        if (runtime) { await runtime.evaluate('window.customStremioDesktop.quit()').catch(() => { /* Page may already be closed. */ }); runtime.close(); }
        // Cleanup only this test installation after its processes finish, never another user app.
        if (fs.existsSync(uninstaller)) {
            await waitFor(async () => runSetup(uninstaller, ['/S']), (code) => code === 0, 40000).catch((error) => { report.cleanupError = error.message; });
        }
        source.closeAllConnections();
        await new Promise((resolve) => source.close(resolve));
        fs.writeFileSync(path.join(qa, 'update-result.json'), `${JSON.stringify(report, null, 2)}\n`);
        void launched;
    }
    assert(!report.cleanupError, report.cleanupError);
    process.stdout.write('Personal update passed: installed A -> failed B/restore -> verified B, graceful service exit, profile/settings/records/history/media retention, private backups.\n');
};
main().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
