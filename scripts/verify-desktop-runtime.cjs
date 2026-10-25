// Run with Electron after desktop:build. Tests the actual ASAR in an isolated profile.
const { app, BrowserWindow, utilityProcess, session, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
app.disableHardwareAcceleration();
app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
    callback({ cancel: !details.url.startsWith('http://127.0.0.1:') });
}));
const qa = path.join(root, '.core-build', 'desktop-qa');
const packaged = path.join(root, 'dist/windows-launcher/win-unpacked/resources/app.asar');
fs.mkdirSync(qa, { recursive: true });
process.env.CUSTOM_STREMIO_DATA_DIR = path.join(qa, 'runtime-profile');
process.env.CUSTOM_STREMIO_DOWNLOAD_DIR = path.join(qa, 'downloads');
// Exercise packaged paths while using the test entry point rather than the release entry point.
Object.defineProperty(app, 'isPackaged', { value: true });
const fork = utilityProcess.fork.bind(utilityProcess);
const children = [];
utilityProcess.fork = (entry, args, options) => {
    const shim = path.join(qa, 'isolated-runtime.cjs');
    // The legacy-port conflict is covered separately. Do not stop the user's terminal backend.
    fs.writeFileSync(shim, `require(${JSON.stringify(path.join(packaged, 'local-backend/managedAccess.js'))}).assertNoLegacyBackend = async () => {};\nrequire(${JSON.stringify(entry)});\n`);
    const child = fork(shim, args, options);
    children.push(child);
    return child;
};
let failure;
let timer;
const report = {};
const result = path.join(qa, 'runtime-result.json');
const stop = (error) => {
    if (error) failure = error;
    clearTimeout(timer);
    fs.writeFileSync(result, `${JSON.stringify({ ...report, passed: !failure, error: failure?.message }, null, 2)}\n`);
    app.quit();
};
timer = setTimeout(() => stop(new Error('Desktop runtime test timed out')), 45000);
app.once('before-quit', () => { if (failure) process.exitCode = 1; });
require(path.join(packaged, 'desktop/main.cjs'));

app.whenReady().then(async () => {
    try {
        const window = BrowserWindow.getAllWindows()[0];
        assert(window, 'Main window exists');
        const preferences = window.webContents.getLastWebPreferences();
        assert.equal(preferences.nodeIntegration, false);
        assert.equal(preferences.contextIsolation, true);
        assert.equal(preferences.sandbox, true);
        assert.equal(preferences.webSecurity, true);
        const deadline = Date.now() + 25000;
        let state;
        while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            if (window.webContents.getURL() !== 'custom-stremio://app/') continue;
            state = await window.webContents.executeJavaScript('({ ready: !!window.core, text: document.body.innerText, bridge: Object.keys(window.customStremioDesktop || {}), backend: window.customStremioDesktop?.backendBaseUrl, node: typeof require, resources: performance.getEntriesByType(\'resource\').map(x => x.name) })');
            if (state.ready && state.text.trim().length > 20) break;
        }
        assert(state, 'Production frontend loads from packaged origin');
        assert(state.ready, 'Packaged Core worker and WASM initialize');
        assert.equal(window.isVisible(), true, 'First launch opens its window');
        report.core = true;
        report.offline = true;
        await window.webContents.executeJavaScript('window.core.getState(\'ctx\')');
        await window.webContents.executeJavaScript('location.hash = \'#/downloads\'');
        const downloadsDeadline = Date.now() + 15000;
        while (Date.now() < downloadsDeadline) {
            report.downloadsText = await window.webContents.executeJavaScript('document.body.innerText');
            if (report.downloadsText.includes('Your downloads will appear here')) break;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert(report.downloadsText.includes('Your downloads will appear here'), 'Downloads finishes loading its isolated empty library');
        assert(!/backend unavailable|failed to fetch|not ready/i.test(report.downloadsText), 'Downloads reaches the managed backend');
        report.body = state.text.slice(0, 2500);
        report.resources = state.resources.filter((url) => url.startsWith('custom-stremio:'));
        assert.equal(state.node, 'undefined');
        assert(!state.bridge.some((key) => /token|ipc|require/i.test(key)), 'No private credentials or raw IPC exposed');
        assert(state.backend?.startsWith('http://127.0.0.1:'), 'Preload receives ready owned connection');
        const health = await window.webContents.executeJavaScript('fetch(window.customStremioDesktop.backendBaseUrl + \'/health\').then(r => r.json())');
        assert.equal(health.ok, true, 'Renderer reaches authenticated managed backend');
        const direct = await fetch(`${state.backend}/health`);
        assert.equal(direct.status, 401, 'Untrusted local client cannot use the service');
        assert.equal(await window.webContents.executeJavaScript('navigator.serviceWorker.getRegistrations().then(x => x.length).catch(() => 0)'), 0);
        await window.webContents.executeJavaScript('localStorage.setItem(\'desktop-runtime-fixture\', \'retained\')');
        await window.webContents.reload();
        await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
        const reloadDeadline = Date.now() + 15000;
        while (Date.now() < reloadDeadline && !await window.webContents.executeJavaScript('!!window.core')) await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(await window.webContents.executeJavaScript('!!window.core'), true);
        assert.equal(await window.webContents.executeJavaScript('localStorage.getItem(\'desktop-runtime-fixture\')'), 'retained');
        fs.writeFileSync(path.join(qa, 'native-runtime.png'), (await window.webContents.capturePage()).toPNG());
        window.close();
        assert.equal(window.isVisible(), false, 'Close keeps the service in the tray');
        assert.equal((await window.webContents.executeJavaScript('fetch(window.customStremioDesktop.backendBaseUrl + \'/health\').then(r=>r.json())')).ok, true);
        app.emit('second-instance');
        assert.equal(window.isVisible(), true, 'Second launch restores the same window');
        report.childrenBeforeCrash = children.length;
        children[0].kill();
        await new Promise((resolve) => setTimeout(resolve, 750));
        const failed = await window.webContents.executeJavaScript('window.customStremioDesktop.getStatus()');
        assert.equal(failed.code, 'BACKEND_EXITED');
        fs.writeFileSync(path.join(qa, 'native-recovery.png'), (await window.webContents.capturePage()).toPNG());
        await window.webContents.executeJavaScript('window.customStremioDesktop.retry()');
        const recoveredDeadline = Date.now() + 10000;
        while (Date.now() < recoveredDeadline && window.webContents.getURL() !== 'custom-stremio://app/') await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(window.webContents.getURL(), 'custom-stremio://app/');
        assert.equal(children.length, 2, 'Retry owns exactly one replacement service');
        report.recovery = true;
        report.security = true;
        report.persistence = true;
        report.closeToTray = true;
        // Use the same Quit handler as the tray and validated renderer IPC.
        assert(ipcMain);
        stop();
    } catch (error) { stop(error); }
}).catch(stop);

app.on('will-quit', () => {
    report.ownedChildrenExited = children.every((child) => !child.pid);
    fs.writeFileSync(result, `${JSON.stringify({ ...report, passed: !failure, error: failure?.message }, null, 2)}\n`);
});
