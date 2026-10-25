/* global test, expect */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { isAppUrl, resolveAppFile, safeExternalUrl, createAppProtocolHandler } = require('../desktop/app-protocol.cjs');
const { getLocalBackendBaseUrl, getBackendSettings } = require('../src/customStremio/localBackendClient');

test('app protocol limits access to its packaged asset roots', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-stremio-protocol-'));
    const build = path.join(root, 'build');
    const desktop = path.join(root, 'desktop');
    fs.mkdirSync(build);
    fs.mkdirSync(path.join(desktop, 'ui'), { recursive: true });
    fs.writeFileSync(path.join(build, 'index.html'), '<main>app</main>');
    fs.writeFileSync(path.join(desktop, 'ui', 'desktop-status.js'), 'status');
    const handler = createAppProtocolHandler({ buildDirectory: build, desktopDirectory: desktop,
        fetchFile: async (url) => new Response(fs.readFileSync(fileURLToPath(url))) });
    try {
        expect(isAppUrl('custom-stremio://app/')).toBe(true);
        for (const url of ['file:///etc/passwd', 'custom-stremio://other/', 'custom-stremio://user@app/', 'custom-stremio://app/%2e%2e%2fsecret', 'custom-stremio://app/c:%5csecret', 'custom-stremio://app/%00', 'custom-stremio://app/%ff']) {
            expect(resolveAppFile(url, build, desktop)).toBeNull();
        }
        const response = await handler(new Request('custom-stremio://app/'));
        expect(await response.text()).toBe('<main>app</main>');
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(response.headers.get('Content-Security-Policy')).toContain('object-src \'none\'');
        const script = await handler(new Request('custom-stremio://app/desktop-status.js'));
        expect(script.headers.get('Content-Type')).toBe('text/javascript');
        expect((await handler(new Request('custom-stremio://app/missing'))).status).toBe(404);
        expect((await handler(new Request('custom-stremio://app/', { method: 'POST' }))).status).toBe(405);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('external opening accepts web and magnet links and rejects native command paths', () => {
    for (const value of ['file:///C:/Windows/cmd.exe', 'javascript:alert(1)', 'powershell:command', 'https://user:pass@example.com', 'https://example.com\n']) expect(safeExternalUrl(value)).toBeNull();
    expect(safeExternalUrl('https://example.com')).toBe('https://example.com/');
    expect(safeExternalUrl('magnet:?xt=urn:btih:fixture')).toBe('magnet:?xt=urn:btih:fixture');
});

test('desktop client uses only its private loopback endpoint and fails closed before readiness', async () => {
    const previous = global.window;
    try {
        global.window = { customStremioDesktop: { backendBaseUrl: 'http://127.0.0.1:44221' } };
        expect(getLocalBackendBaseUrl()).toBe('http://127.0.0.1:44221');
        for (const value of [null, 'http://localhost:5577', 'https://example.com', 'http://127.0.0.1:1/private', 'http://user@127.0.0.1:5577']) {
            global.window.customStremioDesktop.backendBaseUrl = value;
            await expect(getBackendSettings()).rejects.toThrow('not ready');
        }
        global.window = {};
        expect(getLocalBackendBaseUrl()).toBe('http://127.0.0.1:5577');
    } finally {
        if (previous === undefined) delete global.window;
        else global.window = previous;
    }
});
