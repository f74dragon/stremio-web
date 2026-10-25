const { app, BrowserWindow, Menu, Tray, ipcMain, net, protocol, session, shell, utilityProcess, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { PersonalUpdater } = require('./personal-update.cjs');
const { getDesktopDataPaths } = require('./data-paths.cjs');
const { BackendController } = require('./backend-controller.cjs');
const { isAppUrl, safeExternalUrl, createAppProtocolHandler } = require('./app-protocol.cjs');
const { TOKEN_HEADER } = require('../local-backend/managedAccess');
const release = require('./release-config.json');
const { productName, version } = require('./package.json');

protocol.registerSchemesAsPrivileged([{ scheme: 'custom-stremio', privileges: {
    standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true
} }]);
app.setName(productName);
app.setAppUserModelId(release.appId);
const dataPaths = getDesktopDataPaths();
for (const directory of [dataPaths.userData, dataPaths.sessionData, dataPaths.logs]) fs.mkdirSync(directory, { recursive: true });
app.setPath('userData', dataPaths.userData);
app.setPath('sessionData', dataPaths.sessionData);
app.setPath('logs', dataPaths.logs);

let window;
let tray;
let updatesWindow;
let quitting = false;
let quitComplete = false;
let starting = false;
let closeNoticeShown = false;
let status = { phase: 'starting', message: 'Starting your local service…', version };
const root = path.resolve(__dirname, '..');
const buildDirectory = app.isPackaged ? path.join(root, 'build') : path.join(root, '.core-build', 'desktop-ui');
const statusUrl = `${release.rendererOrigin}/desktop-status.html`;
const icon = path.join(__dirname, 'assets', 'icon.ico');
const updatesUrl = `${release.rendererOrigin}/desktop-updates.html`;
const updater = new PersonalUpdater({
    directory: path.join(dataPaths.backendData, 'updates'), currentVersion: version, appId: release.appId,
    publicKey: fs.readFileSync(path.join(__dirname, 'update-public-key.pem'), 'utf8')
});
const installation = path.dirname(process.execPath);
const canInstallUpdate = () => app.isPackaged && process.platform === 'win32' &&
    fs.existsSync(path.join(installation, `Uninstall ${release.executableName}.exe`));
const updateStatus = () => ({ ...updater.state, installable: canInstallUpdate() });
updater.on('status', () => {
    if (updatesWindow && !updatesWindow.isDestroyed()) updatesWindow.webContents.send('custom-stremio:update-status', updateStatus());
});
const backend = new BackendController({
    dataDirectory: dataPaths.backendData,
    fork: (entry, options) => utilityProcess.fork(entry, [], { ...options, serviceName: `${productName} local service` })
});

const log = (event, code = '') => {
    // Deliberately exclude URLs, provider errors, tokens, paths, and account/media data.
    try { fs.appendFileSync(path.join(dataPaths.logs, 'launcher.log'), `${JSON.stringify({ time: new Date().toISOString(), event, code, version })}\n`); } catch { /* Diagnostics cannot prevent recovery. */ }
};
const setStatus = (next) => {
    status = { ...status, ...next };
    if (window && !window.isDestroyed()) window.webContents.send('custom-stremio:status-changed', status);
};
const showWindow = () => {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
};
const showStatus = async () => {
    if (window && !window.isDestroyed()) await window.loadURL(statusUrl);
};
const trustedSender = (event) => window && event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame && isAppUrl(event.senderFrame.url);
const openExternal = (url) => {
    const safe = safeExternalUrl(url);
    if (safe) shell.openExternal(safe).catch(() => log('external-open-failed'));
};

const start = async () => {
    if (starting || quitting) return;
    starting = true;
    setStatus({ phase: 'starting', message: 'Starting your local service…', code: null });
    try {
        await backend.stop();
        if (!fs.existsSync(path.join(buildDirectory, 'index.html'))) {
            const error = new Error('The application files are missing. Rebuild or reinstall Custom Stremio, then retry.');
            error.code = 'APP_FILES_MISSING';
            throw error;
        }
        await backend.start();
        if (quitting) return;
        setStatus({ phase: 'ready', message: 'Ready to watch.' });
        await window.loadURL(`${release.rendererOrigin}/`);
        log('ready');
    } catch (error) {
        await backend.stop().catch(() => log('startup-cleanup-pending'));
        if (!quitting) {
            setStatus({ phase: 'error', message: error.message, code: error.code || 'LAUNCH_FAILED' });
            log('startup-failed', error.code || 'LAUNCH_FAILED');
            await showStatus();
        }
    } finally { starting = false; }
};

const quit = async () => {
    if (quitting) return;
    updater.cancel();
    quitting = true;
    setStatus({ phase: 'stopping', message: 'Pausing downloads and saving your progress…', code: null });
    await showStatus().catch(() => { /* The window may already be closing. */ });
    try {
        const result = await backend.stop();
        log(result.forced ? 'quit-recovery-required' : 'quit-saved');
        quitComplete = true;
        tray?.destroy();
        app.quit();
    } catch {
        quitting = false;
        setStatus({ phase: 'error', message: 'The local service has not finished stopping. Please retry Quit.', code: 'SHUTDOWN_FAILED' });
        showWindow();
    }
};

const openUpdates = () => {
    if (quitting) return;
    if (updatesWindow && !updatesWindow.isDestroyed()) { updatesWindow.show(); updatesWindow.focus(); return; }
    updatesWindow = new BrowserWindow({
        title: 'App updates', parent: window, width: 640, height: 650, minWidth: 560, minHeight: 580,
        backgroundColor: '#101016', autoHideMenuBar: true, icon, show: false,
        webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false }
    });
    updatesWindow.setMenu(null);
    updatesWindow.once('ready-to-show', () => updatesWindow.show());
    updatesWindow.webContents.on('will-navigate', (event, url) => { if (url !== updatesUrl) event.preventDefault(); });
    updatesWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    updatesWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
    updatesWindow.on('closed', () => { updatesWindow = null; });
    updatesWindow.loadURL(updatesUrl).catch(() => log('updates-window-failed'));
};

const installUpdate = async () => {
    if (quitting || updater.busy || updater.state.phase !== 'ready') return updateStatus();
    if (!canInstallUpdate()) return updater.setState({ phase: 'error', code: 'INSTALLED_APP_REQUIRED' });
    if (starting || status.phase !== 'ready') return updateStatus();
    const selected = updater.pending.id;
    const { response } = await dialog.showMessageBox(updatesWindow, {
        type: 'question', title: 'Restart to update', message: `Install version ${updater.state.version}?`,
        detail: 'This pauses downloads, saves your progress, and closes in-app playback. Custom Stremio reopens after the update. Settings, login, and media stay on this PC.',
        buttons: ['Restart and update', 'Cancel'], defaultId: 1, cancelId: 1
    });
    if (response !== 0 || quitting || updater.state.phase !== 'ready' || updater.pending.id !== selected) return updateStatus();
    quitting = true;
    updater.setState({ phase: 'installing', version: updater.pending.manifest.version });
    try {
        const handoff = await updater.createHandoff({
            installation, dataDirectory: dataPaths.backendData, executable: process.execPath,
            // Preserve only explicit local diagnostics flags; never carry URLs or file arguments.
            restartArgs: process.argv.slice(1).filter((argument) => /^(--disable-gpu|--remote-debugging-port=\d+|--remote-debugging-address=127\.0\.0\.1|--inspect=\d+)$/.test(argument))
        });
        setStatus({ phase: 'stopping', message: 'Pausing downloads and saving before the update…', code: null });
        const result = await backend.stop();
        if (result.forced) throw Object.assign(new Error('SHUTDOWN_NOT_CLEAN'), { code: 'SHUTDOWN_NOT_CLEAN' });
        const diagnostic = fs.openSync(path.join(path.dirname(handoff.job), 'helper.log'), 'a');
        let helper;
        try {
            // A windowless native bridge survives our exit; PowerShell cannot directly
            // use DETACHED_PROCESS, and a normal libuv child is killed with its parent.
            helper = spawn(handoff.launcher, [], { detached: true, windowsHide: true, stdio: ['ignore', diagnostic, diagnostic], cwd: dataPaths.backendData });
            await new Promise((resolve, reject) => { helper.once('spawn', resolve); helper.once('error', reject); });
        } finally { fs.closeSync(diagnostic); }
        await new Promise((resolve, reject) => {
            const finish = (error) => { clearInterval(poll); clearTimeout(timeout); helper.removeListener('exit', exited); if (error) reject(error); else resolve(); };
            const exited = () => finish(new Error('UPDATE_HELPER_EXITED'));
            const poll = setInterval(() => {
                try { if (JSON.parse(fs.readFileSync(handoff.ready, 'utf8')).launcherPid === helper.pid) finish(); } catch { /* Helper is still initializing. */ }
            }, 100);
            const timeout = setTimeout(() => finish(new Error('UPDATE_HELPER_NOT_READY')), 10000);
            helper.once('exit', exited);
        });
        helper.unref();
        log('update-handoff');
        quitComplete = true;
        tray?.destroy();
        app.quit();
    } catch (error) {
        quitting = false;
        updater.setState({ phase: 'error', code: error.code === 'ARTIFACT_MISMATCH' ? error.code : 'UPDATE_NOT_STARTED' });
        log('update-not-started', error.code || 'UPDATE_NOT_STARTED');
        if (backend.phase !== 'ready') await start();
    }
    return updateStatus();
};

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', showWindow);
    app.on('before-quit', (event) => {
        if (!quitComplete) { event.preventDefault(); quit(); }
    });
    app.on('window-all-closed', () => { /* The tray owns the application lifetime. */ });
    app.whenReady().then(async () => {
        session.defaultSession.protocol.handle('custom-stremio', createAppProtocolHandler({
            buildDirectory, desktopDirectory: __dirname, fetchFile: (url) => net.fetch(url)
        }));
        session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
            callback(contents === window?.webContents && isAppUrl(contents.getURL()) &&
                ['fullscreen', 'clipboard-sanitized-write', 'local-network-access', 'local-network'].includes(permission));
        });
        session.defaultSession.setPermissionCheckHandler((contents, permission, origin) =>
            contents === window?.webContents && isAppUrl(origin) &&
            ['fullscreen', 'clipboard-sanitized-write', 'local-network-access', 'local-network'].includes(permission));
        session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
            const headers = { ...details.requestHeaders };
            for (const key of Object.keys(headers)) if (key.toLowerCase() === TOKEN_HEADER.toLowerCase()) delete headers[key];
            const connection = backend.connection;
            if (connection && details.webContentsId === window?.webContents.id && isAppUrl(window.webContents.getURL()) &&
                details.url.startsWith(`${connection.baseUrl}/`)) headers[TOKEN_HEADER] = connection.token;
            callback({ requestHeaders: headers });
        });
        ipcMain.on('custom-stremio:info', (event) => {
            event.returnValue = trustedSender(event) ? { version, backendBaseUrl: backend.connection?.baseUrl || null } : null;
        });
        const handle = (name, action) => ipcMain.handle(`custom-stremio:${name}`, (event) => {
            if (!trustedSender(event)) throw new Error('Untrusted desktop request');
            return action();
        });
        handle('status', () => status);
        handle('retry', () => { start(); });
        handle('quit', () => { quit(); });
        handle('diagnostics', () => shell.openPath(dataPaths.logs));
        handle('open-updates', openUpdates);
        const updateHandle = (name, action) => ipcMain.handle(`custom-stremio:update-${name}`, (event) => {
            if (!updatesWindow || event.sender !== updatesWindow.webContents || event.senderFrame !== updatesWindow.webContents.mainFrame || event.senderFrame.url !== updatesUrl) throw new Error('Untrusted update request');
            return action();
        });
        updateHandle('status', updateStatus);
        updateHandle('choose', async () => {
            if (updater.busy || quitting) return updateStatus();
            const selection = await dialog.showOpenDialog(updatesWindow, { title: 'Choose your personal update bundle', properties: ['openFile'], filters: [{ name: 'Custom Stremio update', extensions: ['json'] }] });
            if (!selection.canceled && selection.filePaths.length === 1) await updater.prepare(selection.filePaths[0]);
            return updateStatus();
        });
        updateHandle('cancel', () => { updater.cancel(); return updateStatus(); });
        updateHandle('install', installUpdate);
        updateHandle('close', () => updatesWindow.close());
        window = new BrowserWindow({
            title: productName, width: 1280, height: 840, minWidth: 820, minHeight: 600,
            backgroundColor: '#101016', show: false, autoHideMenuBar: true, icon,
            webPreferences: {
                preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false,
                contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false
            }
        });
        window.once('ready-to-show', showWindow);
        window.webContents.on('page-title-updated', (event) => { event.preventDefault(); window.setTitle(productName); });
        window.webContents.on('will-navigate', (event, url) => {
            if (!isAppUrl(url)) { event.preventDefault(); openExternal(url); }
        });
        window.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
        window.webContents.on('will-attach-webview', (event) => event.preventDefault());
        window.webContents.on('render-process-gone', () => {
            log('renderer-stopped');
            setStatus({ phase: 'error', message: 'The window stopped responding. Retry to reopen it safely.', code: 'RENDERER_STOPPED' });
            showStatus().catch(() => { /* A final Quit may already have closed the window. */ });
        });
        window.webContents.on('did-fail-load', (_event, code, _description, url, mainFrame) => {
            if (!mainFrame || code === -3 || url === statusUrl || quitting) return;
            log('window-load-failed', String(code));
            setStatus({ phase: 'error', message: 'The application window could not load. Retry to reopen it.', code: 'WINDOW_LOAD_FAILED' });
            showStatus().catch(() => { /* Quit may already be closing the window. */ });
        });
        window.on('close', (event) => {
            if (quitting) return;
            event.preventDefault();
            window.hide();
            if (!closeNoticeShown && process.platform === 'win32') {
                closeNoticeShown = true;
                tray.displayBalloon({ title: `${productName} is still running`, content: 'Downloads continue in the background. Choose Quit from the tray menu to exit.' });
            }
        });
        tray = new Tray(icon);
        tray.setToolTip(`${productName} — downloads continue when this window closes`);
        tray.on('click', showWindow);
        tray.setContextMenu(Menu.buildFromTemplate([
            { label: `Open ${productName}`, click: showWindow },
            { label: 'App updates…', click: openUpdates },
            { label: 'Open diagnostics folder', click: () => shell.openPath(dataPaths.logs) },
            { type: 'separator' }, { label: 'Quit', click: quit }
        ]));
        Menu.setApplicationMenu(Menu.buildFromTemplate([
            { label: 'App', submenu: [{ label: 'Show window', click: showWindow }, { label: 'App updates…', click: openUpdates }, { label: 'Quit', accelerator: 'Control+Q', click: quit }] },
            { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }] },
            { label: 'Help', submenu: [
                { label: 'Playback requirements', click: async () => {
                    let streamingReady = false;
                    try { streamingReady = (await fetch('http://127.0.0.1:11470/settings', { signal: AbortSignal.timeout(1500) })).ok; } catch { /* Optional service may be offline. */ }
                    const { response } = await dialog.showMessageBox(window, {
                        type: 'info', title: 'Playback requirements', message: 'Your download service starts with the app.',
                        detail: `Select MPC-HC in Downloads settings for local playback.\n\nStremio streaming service: ${streamingReady ? 'responding' : 'not responding'} on port 11470. Some streaming formats need that separate service. It is optional for browsing and direct downloads.`,
                        buttons: ['OK', 'Get Stremio service'], defaultId: 0, cancelId: 0
                    });
                    if (response === 1) openExternal('https://www.stremio.com/download-service');
                } },
                { label: 'Open diagnostics folder', click: () => shell.openPath(dataPaths.logs) },
                { label: `About ${productName}`, click: () => dialog.showMessageBox(window, { type: 'info', message: productName, detail: `Version ${version}\nPersonal Stremio Web fork.\nClose to tray to continue downloads; choose Quit to save and exit.` }) }
            ] }
        ]));
        backend.on('failure', (error) => {
            if (quitting || starting) return;
            setStatus({ phase: 'error', message: error.message, code: error.code });
            log('backend-stopped', error.code);
            showStatus().catch(() => { /* A final Quit may already have closed the window. */ });
        });
        log('starting');
        await updater.initialize();
        await showStatus();
        showWindow();
        await start();
    }).catch(() => {
        log('launcher-failed');
        dialog.showErrorBox(productName, 'The launcher could not start. Rebuild or reinstall the app.');
        quit();
    });
}
