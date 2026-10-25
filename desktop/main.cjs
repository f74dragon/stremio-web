const { app, BrowserWindow, Menu, Tray, ipcMain, net, protocol, session, shell, utilityProcess, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
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
let quitting = false;
let quitComplete = false;
let starting = false;
let closeNoticeShown = false;
let status = { phase: 'starting', message: 'Starting your local service…', version };
const root = path.resolve(__dirname, '..');
const buildDirectory = app.isPackaged ? path.join(root, 'build') : path.join(root, '.core-build', 'desktop-ui');
const statusUrl = `${release.rendererOrigin}/desktop-status.html`;
const builtIcon = path.join(buildDirectory, 'favicons', 'favicon.ico');
const icon = fs.existsSync(builtIcon) ? builtIcon : path.join(root, 'assets', 'favicons', 'favicon.ico');
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
            { label: 'Open diagnostics folder', click: () => shell.openPath(dataPaths.logs) },
            { type: 'separator' }, { label: 'Quit', click: quit }
        ]));
        Menu.setApplicationMenu(Menu.buildFromTemplate([
            { label: 'App', submenu: [{ label: 'Show window', click: showWindow }, { label: 'Quit', accelerator: 'Control+Q', click: quit }] },
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
        await showStatus();
        showWindow();
        await start();
    }).catch(() => {
        log('launcher-failed');
        dialog.showErrorBox(productName, 'The launcher could not start. Rebuild or reinstall the app.');
        quit();
    });
}
