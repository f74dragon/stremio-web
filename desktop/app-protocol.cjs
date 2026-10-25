const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const isAppUrl = (value) => {
    try {
        const url = new URL(value);
        return url.protocol === 'custom-stremio:' && url.hostname === 'app' && !url.port && !url.username && !url.password;
    } catch { return false; }
};

const resolveAppFile = (value, buildDirectory, desktopDirectory) => {
    if (!isAppUrl(value)) return null;
    let pathname;
    try { pathname = decodeURIComponent(new URL(value).pathname); } catch { return null; }
    if (/[\\\0:]/.test(pathname)) return null;
    const statusFiles = new Set(['/desktop-status.html', '/desktop-status.js', '/desktop-status.css']);
    const root = statusFiles.has(pathname) ? path.join(desktopDirectory, 'ui') : buildDirectory;
    const filename = pathname === '/' ? 'index.html' : pathname.slice(1);
    const resolved = path.resolve(root, filename);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return resolved;
};

const CSP = 'default-src \'self\'; script-src \'self\' \'wasm-unsafe-eval\' https://www.gstatic.com https://appleid.cdn-apple.com; worker-src \'self\' blob:; style-src \'self\' \'unsafe-inline\'; connect-src \'self\' https: http: wss: ws:; img-src \'self\' https: http: data: blob:; media-src \'self\' https: http: blob: data:; font-src \'self\' data:; frame-src https://appleid.apple.com https://accounts.google.com; object-src \'none\'; base-uri \'self\'';

const createAppProtocolHandler = ({ buildDirectory, desktopDirectory, fetchFile }) => async (request) => {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    const file = resolveAppFile(request.url, buildDirectory, desktopDirectory);
    if (!file) return new Response('Not found', { status: 404 });
    try {
        if (!fs.statSync(file).isFile()) return new Response('Not found', { status: 404 });
        const response = await fetchFile(pathToFileURL(file).toString());
        const headers = new Headers(response.headers);
        headers.set('Content-Security-Policy', CSP);
        headers.set('Cache-Control', 'no-store');
        headers.set('X-Content-Type-Options', 'nosniff');
        const types = { '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.html': 'text/html; charset=utf-8' };
        if (types[path.extname(file)]) headers.set('Content-Type', types[path.extname(file)]);
        return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
    } catch { return new Response('Not found', { status: 404 }); }
};

const safeExternalUrl = (value) => {
    try {
        if (typeof value !== 'string' || value.length > 16384 || /[\r\n\0]/.test(value)) return null;
        const url = new URL(value);
        return ['https:', 'http:', 'magnet:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
};

module.exports = { isAppUrl, resolveAppFile, createAppProtocolHandler, safeExternalUrl, CSP };
