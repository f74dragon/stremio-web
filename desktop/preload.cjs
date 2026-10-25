const { contextBridge, ipcRenderer } = require('electron');
const info = ipcRenderer.sendSync('custom-stremio:info');

contextBridge.exposeInMainWorld('customStremioDesktop', Object.freeze({
    version: info?.version || null,
    backendBaseUrl: info?.backendBaseUrl || null,
    getStatus: () => ipcRenderer.invoke('custom-stremio:status'),
    retry: () => ipcRenderer.invoke('custom-stremio:retry'),
    quit: () => ipcRenderer.invoke('custom-stremio:quit'),
    openDiagnostics: () => ipcRenderer.invoke('custom-stremio:diagnostics'),
    onStatus: (callback) => {
        const listener = (_event, status) => callback(status);
        ipcRenderer.on('custom-stremio:status-changed', listener);
        return () => ipcRenderer.removeListener('custom-stremio:status-changed', listener);
    }
}));
