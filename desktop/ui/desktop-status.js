const desktop = window.customStremioDesktop;
const render = (status) => {
    document.getElementById('title').textContent = status.phase === 'error' ? 'Let’s get you back in' : status.phase === 'stopping' ? 'Saving your place' : 'Getting things ready';
    document.getElementById('message').textContent = status.message;
    document.getElementById('actions').hidden = status.phase !== 'error';
    document.getElementById('progress').hidden = status.phase === 'error';
    document.getElementById('code').textContent = status.code ? `Reference: ${status.code}` : '';
    document.getElementById('version').textContent = `Version ${status.version}`;
};
desktop.onStatus(render);
desktop.getStatus().then(render);
document.getElementById('retry').addEventListener('click', () => desktop.retry());
document.getElementById('diagnostics').addEventListener('click', () => desktop.openDiagnostics());
document.getElementById('quit').addEventListener('click', () => desktop.quit());
