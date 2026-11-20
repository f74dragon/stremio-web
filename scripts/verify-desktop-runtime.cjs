// Run with Electron after desktop:build. Tests the actual ASAR in an isolated profile.
const { app, BrowserWindow, utilityProcess, session, ipcMain, dialog } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
app.disableHardwareAcceleration();
app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
    callback({ cancel: !details.url.startsWith('http://127.0.0.1:') });
}));
const qa = path.join(root, '.core-build', 'desktop-qa');
const application = path.resolve(process.env.CUSTOM_STREMIO_TEST_APP_DIRECTORY || path.join(root, 'dist/windows-launcher/win-unpacked'));
assert(!path.relative(root, application).startsWith('..') && !path.isAbsolute(path.relative(root, application)), 'Runtime fixture stays in this workspace');
const packaged = path.join(application, 'resources/app.asar');
fs.mkdirSync(qa, { recursive: true });
process.env.CUSTOM_STREMIO_DATA_DIR = path.join(qa, 'runtime-profile');
process.env.CUSTOM_STREMIO_DOWNLOAD_DIR = path.join(qa, 'downloads');
fs.mkdirSync(process.env.CUSTOM_STREMIO_DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.CUSTOM_STREMIO_DATA_DIR, 'desktop-preferences.json'), JSON.stringify({ version: 1, closeBehavior: 'tray' }));
const manifest = { id: 'org.customstremio.qa', version: '1.0.0', name: 'Local QA sources', description: 'Isolated size visibility fixture',
    types: ['series'], resources: ['meta', 'stream'], catalogs: [], idPrefixes: ['qa-health'] };
const fixtureServer = http.createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Content-Type', 'application/json');
    const body = request.url.includes('/meta/') ? { meta: { id: 'qa-health', type: 'series', name: 'Size visibility fixture',
        description: 'Synthetic title for checking size badges in a narrow sidebar.', videos: [{ id: 'qa-health:1:1', title: 'The long filename episode', season: 1, episode: 1, released: '2020-01-01T00:00:00.000Z' }] } } :
        request.url.includes('/stream/') ? { streams: [
            { name: 'Local QA 1080p', title: `${'A.very.long.release.filename.'.repeat(12)}\n💾 12.5 GB`, url: `http://127.0.0.1:${fixtureServer.address().port}/media.mp4`, behaviorHints: { videoSize: 12.5 * 1024 ** 3 } },
            { name: 'Local QA 720p', title: 'An addon that does not report a size', url: `http://127.0.0.1:${fixtureServer.address().port}/unknown.mp4` }
        ] } : manifest;
    response.end(JSON.stringify(body));
});
const fixtureReady = new Promise((resolve) => fixtureServer.listen(0, '127.0.0.1', resolve));
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
        await fixtureReady;
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
        const click = async (text) => {
            const deadline = Date.now() + 10000;
            while (Date.now() < deadline) {
                const clicked = await window.webContents.executeJavaScript(`(() => {
                    const element = Array.from(document.querySelectorAll('button,[role="button"],[tabindex="0"]')).find(item => item.innerText.trim() === ${JSON.stringify(text)} && !item.disabled && !item.classList.contains('disabled'));
                    if (!element) return false; element.click(); return true;
                })()`);
                if (clicked) return;
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
            throw new Error(`Missing enabled UI control: ${text}`);
        };
        const waitForText = async (text) => {
            const deadline = Date.now() + 10000;
            while (Date.now() < deadline) {
                if (await window.webContents.executeJavaScript(`document.body.innerText.includes(${JSON.stringify(text)})`)) return;
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
            throw new Error(`Missing runtime UI: ${text}`);
        };
        await click('Settings');
        await waitForText('Settings, records, history, and playback progress loaded.');
        await waitForText('The Core worker responded. Individual addon streams depend on their own services.');
        fs.writeFileSync(path.join(qa, 'native-health.png'), (await window.webContents.capturePage()).toPNG());
        window.setSize(840, 840);
        await new Promise((resolve) => setTimeout(resolve, 150));
        fs.writeFileSync(path.join(qa, 'native-health-narrow.png'), (await window.webContents.capturePage()).toPNG());
        await window.webContents.executeJavaScript('localStorage.setItem(\'customStremio.batchDownloadSession\', \'fixture-selection\')');
        await click('Clear episode selection…');
        await waitForText('Clear saved episode selection?');
        await click('Cancel');
        assert.equal(await window.webContents.executeJavaScript('localStorage.getItem(\'customStremio.batchDownloadSession\')'), 'fixture-selection');
        await click('Clear episode selection…');
        await click('Clear selection');
        await waitForText('Saved episode selection cleared.');
        assert.equal(await window.webContents.executeJavaScript('localStorage.getItem(\'customStremio.batchDownloadSession\')'), null);
        await click('Reset download options…');
        await click('Reset options');
        await waitForText('Simultaneous downloads reset to 2.');
        assert.equal((await window.webContents.executeJavaScript('fetch(window.customStremioDesktop.backendBaseUrl + \'/settings\').then(r=>r.json())')).downloads.maxConcurrentDownloads, 2);
        report.healthAndResets = true;
        assert.equal((await window.webContents.executeJavaScript('window.customStremioDesktop.setCloseBehavior(\'quit\')')).closeBehavior, 'quit');
        assert.equal(await window.webContents.executeJavaScript('window.customStremioDesktop.setCloseBehavior(\'invalid\').then(()=>false,()=>true)'), true);
        await window.webContents.executeJavaScript('window.customStremioDesktop.setCloseBehavior(\'tray\')');
        const addon = { transportUrl: `http://127.0.0.1:${fixtureServer.address().port}/manifest.json`, manifest, flags: { official: false, protected: false } };
        const addonError = await window.webContents.executeJavaScript(`(async () => { try {
            await window.core.dispatch({ action: 'Ctx', args: { action: 'InstallAddon', args: ${JSON.stringify(addon)} } }); return null;
        } catch (error) { return String(error); } })()`);
        assert.equal(addonError, null, `Local fixture addon installs: ${addonError}`);
        await window.webContents.executeJavaScript('location.hash = \'#/metadetails/series/qa-health/qa-health:1:1\'');
        await waitForText('12.5 GB');
        const badges = await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[aria-label^="File size:"]')).map(element => {
            const box = element.getBoundingClientRect(); return { label: element.innerText, visible: box.width > 0 && box.right <= innerWidth && element.scrollWidth <= element.clientWidth + 1 };
        })`);
        assert(badges.some((item) => item.label === '12.5 GB' && item.visible), 'Long filenames cannot clip the independent file size');
        assert(badges.some((item) => item.label === 'Size unknown' && item.visible), 'Missing sizes are explicit');
        fs.writeFileSync(path.join(qa, 'native-source-size-narrow.png'), (await window.webContents.capturePage()).toPNG());
        await window.webContents.executeJavaScript(`window.core.dispatch({ action: 'Ctx', args: { action: 'UninstallAddon', args: ${JSON.stringify(addon)} } })`);
        report.sourceSize = true;
        window.setSize(1280, 840);
        await window.webContents.executeJavaScript('location.hash = \'#/downloads\'');
        report.body = state.text.slice(0, 2500);
        report.resources = state.resources.filter((url) => url.startsWith('custom-stremio:'));
        assert.equal(state.node, 'undefined');
        assert(!state.bridge.some((key) => /token|ipc|require/i.test(key)), 'No private credentials or raw IPC exposed');
        assert(state.backend?.startsWith('http://127.0.0.1:'), 'Preload receives ready owned connection');
        const health = await window.webContents.executeJavaScript('fetch(window.customStremioDesktop.backendBaseUrl + \'/health\').then(r => r.json())');
        assert.equal(health.ok, true, 'Renderer reaches authenticated managed backend');
        const rejectedDownload = await window.webContents.executeJavaScript(`fetch(window.customStremioDesktop.backendBaseUrl + '/downloads', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
        }).then(async response => ({ status: response.status, body: await response.json() }))`);
        assert.equal(rejectedDownload.status, 400, 'Packaged JSON download requests reach the backend');
        assert(rejectedDownload.body.error.includes('No usable source URL'), 'Download rejection details reach the renderer');
        report.downloadRequests = true;
        const direct = await fetch(`${state.backend}/health`);
        assert.equal(direct.status, 401, 'Untrusted local client cannot use the service');
        assert.equal(await window.webContents.executeJavaScript('navigator.serviceWorker.getRegistrations().then(x => x.length).catch(() => 0)'), 0);
        assert.equal(await window.webContents.executeJavaScript('window.customStremioDesktop.getUpdateStatus().then(() => false, () => true)'), true, 'Main renderer cannot invoke updater privileges');
        await window.webContents.executeJavaScript('window.customStremioDesktop.openUpdates()');
        const updatesWindow = BrowserWindow.getAllWindows().find((item) => item !== window);
        assert(updatesWindow, 'Dedicated update window opens');
        if (updatesWindow.webContents.isLoadingMainFrame()) await new Promise((resolve) => updatesWindow.webContents.once('did-finish-load', resolve));
        assert.equal(await updatesWindow.webContents.executeJavaScript('typeof require'), 'undefined');
        assert.equal(await updatesWindow.webContents.executeJavaScript('window.customStremioDesktop.getStatus().then(() => false, () => true)'), true, 'Update page cannot access backend lifecycle IPC');
        assert.equal(await updatesWindow.webContents.executeJavaScript('window.customStremioDesktop.restartService().then(() => false, () => true)'), true, 'Update page cannot restart the download service');
        assert.equal(await updatesWindow.webContents.executeJavaScript('window.customStremioDesktop.setCloseBehavior(\'quit\').then(() => false, () => true)'), true, 'Update page cannot change desktop preferences');
        assert.equal(await updatesWindow.webContents.executeJavaScript('window.customStremioDesktop.getUpdateStatus().then(s => s.currentVersion)'), require(path.join(packaged, 'desktop/package.json')).version);
        fs.writeFileSync(path.join(qa, 'native-updates.png'), (await updatesWindow.webContents.capturePage()).toPNG());
        updatesWindow.close();
        report.updatesBoundary = true;
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
        const waitForReady = async (previousUrl = null) => {
            const deadline = Date.now() + 15000;
            while (Date.now() < deadline) {
                if (window.webContents.getURL() === 'custom-stremio://app/' && !window.webContents.isLoadingMainFrame()) {
                    try {
                        const current = await window.webContents.executeJavaScript('({ core: !!window.core, backend: window.customStremioDesktop.backendBaseUrl })');
                        if (current.core && current.backend && current.backend !== previousUrl) return current.backend;
                    } catch { /* Navigation can replace the execution context while polling. */ }
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
            throw new Error('Replacement frontend did not receive its new backend connection');
        };
        const beforeRestart = await waitForReady();
        dialog.showMessageBox = async () => ({ response: 1 });
        await window.webContents.executeJavaScript('window.customStremioDesktop.restartService()');
        assert.equal(children.length, 2, 'Cancel never restarts the service');
        dialog.showMessageBox = async () => ({ response: 0 });
        await window.webContents.executeJavaScript('window.customStremioDesktop.restartService(); true');
        await waitForReady(beforeRestart);
        assert.equal(children.length, 3, 'Explicit restart replaces exactly the owned service');
        assert(!children[1].pid, 'Previous owned service exited before replacement');
        report.serviceRestart = true;
        report.recovery = true;
        report.security = true;
        report.persistence = true;
        report.closeToTray = true;
        // Use the same Quit handler as the tray and validated renderer IPC.
        assert(ipcMain);
        if (process.env.CUSTOM_STREMIO_TEST_QUIT_MODE === 'restart') {
            app.relaunch = () => { report.appRelaunch = true; };
            await window.webContents.executeJavaScript('window.customStremioDesktop.restartApp(); true');
        } else {
            await window.webContents.executeJavaScript('window.customStremioDesktop.setCloseBehavior(\'quit\')');
            report.quitOnClose = true;
            window.close();
            assert.equal(window.isVisible(), true, 'Quit on close saves instead of hiding to tray');
        }
    } catch (error) {
        const failedWindow = BrowserWindow.getAllWindows()[0];
        if (failedWindow && !failedWindow.isDestroyed()) fs.writeFileSync(path.join(qa, 'native-failure.png'), (await failedWindow.webContents.capturePage()).toPNG());
        stop(error);
    }
}).catch(stop);

app.on('will-quit', () => {
    fixtureServer.closeAllConnections();
    fixtureServer.close();
    report.ownedChildrenExited = children.every((child) => !child.pid);
    fs.writeFileSync(result, `${JSON.stringify({ ...report, passed: !failure, error: failure?.message }, null, 2)}\n`);
});
