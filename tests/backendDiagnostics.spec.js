/* global describe, test, expect, jest */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createBackendDiagnostics } = require('../local-backend/backendDiagnostics');
const { createBackendSettings } = require('../local-backend/backendSettingsStore');

describe('download diagnostics', () => {
    test('checks local storage without provider calls and reports live checks without leaking secrets', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stremio-diagnostics-'));
        const settings = createBackendSettings(2);
        settings.debrid.allDebrid = { apiKey: 'private-provider-key' };
        settings.debrid.realDebrid = { refreshToken: 'private-refresh-token' };
        settings.player.progressTracking = { enabled: true, port: 13579, watchedSyncEnabled: true };
        const ad = { getUser: jest.fn().mockResolvedValue({ user: {} }) };
        const rd = { getUser: jest.fn().mockRejectedValue(new Error('private-secret-and-url')) };
        const mpc = { getStatus: jest.fn().mockResolvedValue({ state: 'paused' }) };
        const fetchImpl = jest.fn().mockResolvedValue({ ok: false });
        const diagnostics = createBackendDiagnostics({ getSettings: () => settings, getRecords: () => [{ status: 'downloading', speedBytesPerSecond: 2048 }],
            getScheduler: () => ({ activeCount: 1, queuedCount: 2, maxConcurrentDownloads: 2 }), isReady: () => true,
            dataDirectory: root, downloadsDirectory: root, version: 'fixture', validatePlayer: jest.fn(),
            allDebridClient: ad, realDebridClient: rd, getRealDebridToken: async () => 'private-access-token', mpcClient: mpc, fetchImpl });
        try {
            const initial = await diagnostics.snapshot();
            expect(initial.checks.find((item) => item.id === 'alldebrid').state).toBe('unverified');
            expect(ad.getUser).not.toHaveBeenCalled();
            expect(fetchImpl).not.toHaveBeenCalled();
            expect(initial.downloads.speedBytesPerSecond).toBe(2048);
            expect(fs.readdirSync(root)).toEqual([]);
            diagnostics.rememberRejection(409, 'DOWNLOAD_DESTINATION_CONFLICT');
            const first = diagnostics.checkConnections();
            expect(diagnostics.checkConnections()).toBe(first);
            const report = await first;
            expect(ad.getUser).toHaveBeenCalledTimes(1);
            expect(report.checks.find((item) => item.id === 'alldebrid').state).toBe('ok');
            expect(report.checks.find((item) => item.id === 'realdebrid').state).toBe('warning');
            expect(report.checks.find((item) => item.id === 'mpc').state).toBe('ok');
            expect(report.lastRejection.code).toBe('DOWNLOAD_DESTINATION_CONFLICT');
            expect(JSON.stringify(report)).not.toMatch(/private-|https?:|apiKey|refreshToken|accessToken/);
            settings.debrid.allDebrid.apiKey = 'replacement-key';
            expect((await diagnostics.snapshot()).checks.find((item) => item.id === 'alldebrid').state).toBe('unverified');
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
});
