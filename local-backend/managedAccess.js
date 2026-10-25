const crypto = require('crypto');
const http = require('http');
const { DEFAULT_LOCAL_BACKEND_URL, LOCAL_BACKEND_SERVICE_NAME } = require('../src/customStremio/localBackendProtocol');

const TOKEN_HEADER = 'X-Custom-Stremio-Token';
const DESKTOP_ORIGIN = 'custom-stremio://app';

const createManagedAccess = ({ token, origin = DESKTOP_ORIGIN } = {}) => (request, response, next) => {
    const supplied = Buffer.from(String(request.get(TOKEN_HEADER) || ''));
    const expected = Buffer.from(String(token || ''));
    if (expected.length < 32 || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
        response.status(401).json({ ok: false, errorCode: 'BACKEND_AUTH_REQUIRED', error: 'This local service requires its desktop connection.' });
        return;
    }
    const requestOrigin = request.get('Origin');
    if (requestOrigin && requestOrigin !== origin) {
        response.status(403).json({ ok: false, error: 'This origin cannot use the desktop service.' });
        return;
    }
    next();
};

const assertNoLegacyBackend = (baseUrl = DEFAULT_LOCAL_BACKEND_URL) => new Promise((resolve, reject) => {
    const request = http.get(`${baseUrl}/health`, (response) => {
        let contents = '';
        response.on('data', (chunk) => {
            contents += chunk;
            if (contents.length > 16384) request.destroy();
        });
        response.on('end', () => {
            let health;
            try { health = JSON.parse(contents); } catch { resolve(); return; }
            if (health?.service === LOCAL_BACKEND_SERVICE_NAME) {
                const error = new Error('A terminal backend is already running on port 5577. Stop it in its terminal, then retry. Your downloads and settings will be kept.');
                error.code = 'LEGACY_BACKEND_RUNNING';
                reject(error);
            } else resolve();
        });
        response.on('error', () => resolve());
        response.on('aborted', () => resolve());
    });
    request.setTimeout(1000, () => request.destroy());
    request.on('error', () => resolve());
});

module.exports = { TOKEN_HEADER, DESKTOP_ORIGIN, createManagedAccess, assertNoLegacyBackend };
