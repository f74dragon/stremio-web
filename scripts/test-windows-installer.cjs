// Installs only into a fresh workspace fixture; refuses existing real installs/shortcuts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const desktop = require('../desktop/package.json');
const release = require('../desktop/release-config.json');
const { createBackendSettings, writeBackendSettings } = require('../local-backend/backendSettingsStore');
const root = path.resolve(__dirname, '..');
const qa = path.join(root, '.core-build/installer-qa');
const installer = path.join(root, `dist/windows-installer/Custom-Stremio-${desktop.version}-windows-x64-setup.exe`);
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const waitFor = async (operation, predicate, timeout = 15000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const result = await operation();
        if (predicate(result)) return result;
        await delay(100);
    }
    throw new Error('Installer acceptance timed out waiting for expected state');
};
const inspect = (directory = '') => JSON.parse(execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-File',
    path.join(__dirname, 'inspect-windows-installation.ps1'), '-ApplicationDirectory', directory], { encoding: 'utf8', windowsHide: true }).replace(/^\uFEFF/, ''));
const runSetup = (executable, args) => {
    const result = spawnSync(executable, args, { windowsHide: true, windowsVerbatimArguments: true, timeout: 120000 });
    if (result.error) throw result.error;
    return result.status;
};
const snapshot = (directory, relative = '') => Object.fromEntries(fs.readdirSync(path.join(directory, relative), { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(relative, entry.name);
    assert(!entry.isSymbolicLink(), 'Fixture has no links outside its data root');
    return entry.isDirectory() ? Object.entries(snapshot(directory, filename)) : [[filename, crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, filename))).digest('hex')]];
}));
const connect = async (url) => {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let sequence = 0;
    const pending = new Map();
    socket.addEventListener('message', ({ data }) => {
        const result = JSON.parse(data);
        const callback = pending.get(result.id);
        if (callback) { pending.delete(result.id); callback(result); }
    });
    socket.addEventListener('close', () => {
        for (const callback of pending.values()) callback({ error: { message: 'Test connection closed' } });
        pending.clear();
    });
    const command = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Runtime command timed out: ${method}`)); }, 10000);
        pending.set(id, (result) => { clearTimeout(timer); if (result.error) reject(new Error(result.error.message)); else resolve(result.result); });
        socket.send(JSON.stringify({ id, method, params }));
    });
    return { command, close: () => socket.close(), evaluate: async (expression) => {
        const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
    } };
};

const main = async () => {
    assert.equal(process.platform, 'win32', 'Windows installer acceptance runs on Windows');
    assert(fs.existsSync(installer), 'Build desktop:installer first');
    const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(installer), 'release-manifest.json'), 'utf8'));
    assert.equal(manifest.installer.sha256, crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex'), 'Installer matches its release manifest checksum');
    assert.equal(manifest.automaticUpdatesEnabled, false);
    const builderRequire = createRequire(require.resolve('electron-builder'));
    const builderLibrary = createRequire(builderRequire.resolve('app-builder-lib'));
    const asar = builderLibrary('@electron/asar');
    const archive = path.join(path.dirname(installer), 'win-unpacked/resources/app.asar');
    const files = asar.listPackage(archive).map((filename) => filename.replace(/\\/g, '/'));
    for (const filename of ['/LICENSE.md', '/licenses/core-LICENSE.md', '/licenses/core-provenance.json', '/build-info.json', '/desktop/assets/icon.ico']) assert(files.includes(filename), `Packaged attribution/provenance asset exists: ${filename}`);
    assert(files.includes('/desktop/update-public-key.pem'), 'Public update verification key is packaged');
    assert(fs.existsSync(path.join(path.dirname(installer), 'win-unpacked/resources/app.asar.unpacked/desktop/update-launcher.exe')), 'Windowless update bridge is packaged');
    assert(!files.some((filename) => filename !== '/desktop/update-public-key.pem' && /\/(\.git|\.codex|\.agents|\.core-build|desktop-profile|release-backups)(\/|$)|\.(pem|map)$|\/(download-records\.json|backend-settings\.json|download-history\.ndjson|playback-progress\.json|launcher\.log)$/.test(filename)), 'ASAR excludes private/development keys, profiles, stores, logs, backups and source maps');
    const before = inspect();
    assert.equal(before.UserEntries.length + before.MachineEntries.length, 0, 'Refusing to overwrite an existing Custom Stremio installation');
    assert.equal(before.Shortcuts.length, 0, 'Refusing to overwrite existing user shortcuts');
    fs.mkdirSync(qa, { recursive: true });
    const fixture = fs.mkdtempSync(path.join(qa, 'run-'));
    const installation = path.join(fixture, 'Installed App');
    assert(!path.relative(qa, installation).startsWith('..'), 'Install target is inside the isolated QA area');
    const data = path.join(fixture, 'data');
    const media = path.join(fixture, 'media', 'kept.mp4');
    fs.mkdirSync(path.dirname(media), { recursive: true });
    fs.mkdirSync(data);
    fs.writeFileSync(media, 'Synthetic installer retention fixture.');
    fs.writeFileSync(path.join(data, 'download-records.json'), JSON.stringify({ version: 1, records: [{
        id: 'installer-fixture', status: 'completed', metaId: 'installer-fixture', videoId: 'installer-fixture', type: 'movie',
        videoTitle: 'Installer fixture', parentTitle: 'Installer fixture', localPath: media,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
    }] }));
    await writeBackendSettings(path.join(data, 'backend-settings.json'), createBackendSettings(2));
    const report = { fixture, version: desktop.version, signed: false };
    let running;
    const executable = path.join(installation, 'custom-stremio.exe');
    const uninstaller = path.join(installation, `Uninstall ${release.executableName}.exe`);
    const install = () => assert.equal(runSetup(installer, ['/S', `/D=${installation}`]), 0, 'Per-user installer succeeds');
    const uninstall = async () => {
        assert(fs.existsSync(uninstaller), 'Installed uninstaller exists');
        assert.equal(runSetup(uninstaller, ['/S']), 0, 'Uninstaller succeeds');
        await waitFor(async () => !fs.existsSync(executable) && inspect().UserEntries.length === 0, Boolean, 20000);
        assert.equal(inspect().Shortcuts.length, 0, 'Uninstall removes only its shortcuts');
    };
    const launch = async () => {
        const env = { ...process.env, PATH: '', CUSTOM_STREMIO_DATA_DIR: data, CUSTOM_STREMIO_DOWNLOAD_DIR: path.dirname(media) };
        delete env.ELECTRON_RUN_AS_NODE;
        delete env.NODE_OPTIONS;
        delete env.NODE_PATH;
        const child = spawn(executable, ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--disable-gpu'], {
            env, cwd: installation, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']
        });
        const exited = new Promise((resolve) => child.once('close', resolve));
        let debugPort;
        child.stderr.on('data', (chunk) => { const match = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(chunk.toString()); if (match) debugPort = Number(match[1]); });
        running = { child, exited };
        await waitFor(async () => debugPort, Boolean);
        const target = await waitFor(async () => {
            const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
            return pages.find((page) => page.type === 'page' && page.url.startsWith('custom-stremio://app/'));
        }, Boolean);
        const runtime = await connect(target.webSocketDebuggerUrl);
        running.runtime = runtime;
        await waitFor(() => runtime.evaluate('!!window.core && !!window.customStremioDesktop?.backendBaseUrl'), Boolean, 25000);
        assert.equal(await runtime.evaluate('typeof require'), 'undefined');
        const health = await runtime.evaluate('fetch(window.customStremioDesktop.backendBaseUrl + "/health").then(r => r.json())');
        assert.equal(health.ok, true, 'Installed EXE owns a ready managed backend');
        running.baseUrl = await runtime.evaluate('window.customStremioDesktop.backendBaseUrl');
        const settings = await runtime.evaluate('fetch(window.customStremioDesktop.backendBaseUrl + "/settings").then(r => r.json())');
        assert.equal(settings.downloads.maxConcurrentDownloads, 2);
        const records = await runtime.evaluate('fetch(window.customStremioDesktop.backendBaseUrl + "/downloads").then(r => r.json())');
        assert.equal(records.items[0].id, 'installer-fixture');
        return runtime;
    };
    const quit = async () => {
        if (!running) return;
        const current = running;
        await current.runtime.evaluate('window.customStremioDesktop.quit()').catch(() => { /* Closing the page can finish before the reply. */ });
        let timeout;
        let code;
        try {
            code = await Promise.race([current.exited, new Promise((_resolve, reject) => {
                timeout = setTimeout(() => reject(new Error('Installed app did not quit gracefully')), 35000);
            })]);
        } finally { clearTimeout(timeout); }
        assert.equal(code, 0);
        current.runtime.close();
        await assert.rejects(fetch(`${current.baseUrl}/health`, { signal: AbortSignal.timeout(2000) }), 'Quit stops its owned backend');
        running = null;
    };
    try {
        install();
        const state = inspect(installation);
        assert.equal(state.UserEntries.length, 1);
        assert.equal(state.MachineEntries.length, 0, 'No machine-wide registration');
        assert.equal(path.resolve(state.UserEntries[0].InstallLocation), installation);
        assert.equal(state.Shortcuts.length, 2, 'Desktop and Start Menu shortcuts exist');
        for (const shortcut of state.Shortcuts) assert.equal(path.resolve(shortcut.TargetPath), executable);
        assert.equal(state.Metadata.ProductName, desktop.productName);
        assert.equal(state.Metadata.FileDescription, desktop.productName);
        assert.equal(state.UserEntries[0].DisplayVersion, desktop.version, 'Installed Apps preserves the full prerelease version');
        assert.equal(state.Metadata.ProductVersion.split('.').slice(0, 3).join('.'), desktop.version.split('-')[0], 'Windows numeric version matches the release');
        const pe = fs.readFileSync(executable);
        const optionalHeader = pe.readUInt32LE(0x3c) + 24;
        const directory = optionalHeader + (pe.readUInt16LE(optionalHeader) === 0x20b ? 112 : 96);
        assert.equal(pe.readUInt32LE(directory + 4 * 8 + 4), 0, 'Local alpha has no Authenticode certificate');
        assert(pe.includes(fs.readFileSync(path.join(root, 'desktop/assets/icon.png'))), 'PE resources contain the custom icon');
        report.install = true;
        report.branding = true;
        const runtime = await launch();
        await runtime.evaluate('location.hash = "#/downloads"');
        await waitFor(() => runtime.evaluate('document.body.innerText.includes("Installer fixture")'), Boolean);
        const capture = await runtime.command('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(qa, 'installed-downloads.png'), Buffer.from(capture.data, 'base64'));
        await runtime.evaluate('localStorage.setItem("installer-retention-fixture", "saved")');
        assert.equal(runSetup(installer, ['/S', `/D=${installation}`]), 1618, 'Reinstall asks for graceful Quit rather than killing a running app');
        assert.equal(runSetup(uninstaller, ['/S', `_?=${installation}`]), 1618, 'Uninstall refuses to kill the running app');
        assert.equal((await runtime.evaluate('fetch(window.customStremioDesktop.backendBaseUrl + "/health").then(r=>r.json())')).ok, true);
        report.runningAppProtected = true;
        await quit();
        const first = snapshot(data);
        install();
        assert.deepEqual(snapshot(data), first, 'Reinstall preserves every profile/store byte');
        assert.equal(await (await launch()).evaluate('localStorage.getItem("installer-retention-fixture")'), 'saved');
        await quit();
        report.reinstall = true;
        const retained = snapshot(data);
        await uninstall();
        assert.deepEqual(snapshot(data), retained, 'Uninstall preserves all profile, settings, history and progress files');
        assert.equal(fs.readFileSync(media, 'utf8'), 'Synthetic installer retention fixture.');
        report.uninstallRetention = true;
        install();
        assert.equal(await (await launch()).evaluate('localStorage.getItem("installer-retention-fixture")'), 'saved');
        await quit();
        await uninstall();
        report.reinstallAfterUninstall = true;
        report.noExternalNode = true;
        report.passed = true;
    } catch (error) {
        report.error = error.message;
        throw error;
    } finally {
        try {
            if (running?.runtime) await quit();
            else if (running) { running.child.kill(); await running.exited; }
            if (fs.existsSync(uninstaller)) await uninstall();
        } catch (error) { report.cleanupError = error.message; report.passed = false; }
        finally { fs.writeFileSync(path.join(qa, 'installer-result.json'), `${JSON.stringify(report, null, 2)}\n`); }
    }
    assert(!report.cleanupError, report.cleanupError);
    process.stdout.write('Windows installer passed: branding, per-user shortcuts, installed launch without Node/npm on PATH, running-app protection, reinstall, uninstall/data retention.\n');
};
if (require.main === module) main().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
module.exports = { inspect, runSetup, connect, waitFor, snapshot };
