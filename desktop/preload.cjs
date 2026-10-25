const { contextBridge, ipcRenderer } = require('electron');
const info = ipcRenderer.sendSync('custom-stremio:info');

contextBridge.exposeInMainWorld('customStremioDesktop', Object.freeze({
    version: info?.version || null,
    backendBaseUrl: info?.backendBaseUrl || null,
    getStatus: () => ipcRenderer.invoke('custom-stremio:status'),
    retry: () => ipcRenderer.invoke('custom-stremio:retry'),
    quit: () => ipcRenderer.invoke('custom-stremio:quit'),
    openDiagnostics: () => ipcRenderer.invoke('custom-stremio:diagnostics'),
    openUpdates: () => ipcRenderer.invoke('custom-stremio:open-updates'),
    getUpdateStatus: () => ipcRenderer.invoke('custom-stremio:update-status'),
    chooseUpdate: () => ipcRenderer.invoke('custom-stremio:update-choose'),
    cancelUpdate: () => ipcRenderer.invoke('custom-stremio:update-cancel'),
    installUpdate: () => ipcRenderer.invoke('custom-stremio:update-install'),
    closeUpdates: () => ipcRenderer.invoke('custom-stremio:update-close'),
    onUpdateStatus: (callback) => {
        const listener = (_event, state) => callback(state);
        ipcRenderer.on('custom-stremio:update-status', listener);
        return () => ipcRenderer.removeListener('custom-stremio:update-status', listener);
    },
    onStatus: (callback) => {
        const listener = (_event, status) => callback(status);
        ipcRenderer.on('custom-stremio:status-changed', listener);
        return () => ipcRenderer.removeListener('custom-stremio:status-changed', listener);
    }
}));
