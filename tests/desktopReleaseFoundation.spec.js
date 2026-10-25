/* global describe, test, expect */

const path = require('path');
const fs = require('fs');
const os = require('os');
const desktop = require('../desktop/package.json');
const release = require('../desktop/release-config.json');
const { getDesktopDataPaths } = require('../desktop/data-paths.cjs');
const { getDefaultDataDirectory, DownloadRecordStore } = require('../local-backend/downloadRecordStore');

describe('desktop release persistence contract', () => {
    test('keeps the fork identity and origin independent of upstream Stremio releases', () => {
        expect(desktop.name).toBe('custom-stremio-desktop');
        expect(desktop.productName).toBe('Custom Stremio');
        expect(release.appId).toBe('io.github.f74dragon.customstremio');
        expect(release.rendererOrigin).toBe('custom-stremio://app');
        expect(release.releaseRepository).toEqual({ provider: 'github', owner: 'f74dragon', repo: 'stremio-web' });
        expect(release.automaticUpdatesEnabled).toBe(false);
    });

    test('preserves the existing Local AppData root with a separate stable desktop profile', () => {
        const env = { LOCALAPPDATA: path.join(os.tmpdir(), 'example-appdata') };
        const paths = getDesktopDataPaths({ env });
        const backendData = path.join(env.LOCALAPPDATA, 'Custom Stremio');
        expect(paths).toEqual({
            backendData,
            userData: path.join(backendData, 'desktop-profile'),
            sessionData: path.join(backendData, 'desktop-profile', 'session'),
            logs: path.join(backendData, 'logs', 'desktop'),
            updateBackups: path.join(backendData, 'release-backups')
        });
        expect(getDefaultDataDirectory({ env })).toBe(paths.backendData);
    });

    test('honors an existing custom backend root for every desktop data path', () => {
        const env = { CUSTOM_STREMIO_DATA_DIR: './custom-data', LOCALAPPDATA: path.join(os.tmpdir(), 'unused-appdata') };
        const paths = getDesktopDataPaths({ env });
        expect(paths.backendData).toBe(path.resolve('./custom-data'));
        expect(paths.userData).toBe(path.join(paths.backendData, 'desktop-profile'));
    });

    test('retains the existing home-directory fallback when Local AppData is unavailable', () => {
        const homeDirectory = path.join(os.tmpdir(), 'example-home');
        expect(getDesktopDataPaths({ env: {}, homeDirectory }).backendData).toBe(path.join(homeDirectory, '.custom-stremio'));
    });

    test('reads existing backend records through the desktop root without a migration or media move', async () => {
        const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-stremio-release-'));
        try {
            const options = { env: { LOCALAPPDATA: fixtureRoot } };
            const oldRoot = path.join(fixtureRoot, 'Custom Stremio');
            const records = [{ id: 'existing-record', status: 'completed', localPath: path.join(fixtureRoot, 'Media', 'movie.mkv') }];
            fs.mkdirSync(oldRoot);
            fs.writeFileSync(path.join(oldRoot, 'download-records.json'), JSON.stringify({ version: 1, records }));
            const paths = getDesktopDataPaths(options);
            const store = new DownloadRecordStore({ filePath: path.join(paths.backendData, 'download-records.json') });
            await expect(store.load()).resolves.toEqual(records);
            expect(fs.readdirSync(oldRoot)).toEqual(['download-records.json']);
        } finally {
            fs.rmSync(fixtureRoot, { recursive: true, force: true });
        }
    });
});
