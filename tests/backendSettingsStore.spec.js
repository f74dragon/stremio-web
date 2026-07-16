/* global describe, beforeEach, afterEach, test, expect */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    SETTINGS_STORE_VERSION,
    createBackendSettings,
    readBackendSettings,
    writeBackendSettings,
    BackendSettingsStore
} = require('../local-backend/backendSettingsStore');

describe('backendSettingsStore', () => {
    let tempDirectory;
    let settingsPath;

    beforeEach(() => {
        tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-stremio-settings-'));
        settingsPath = path.join(tempDirectory, 'state', 'backend-settings.json');
    });

    afterEach(() => {
        fs.rmSync(tempDirectory, { recursive: true, force: true });
    });

    test('uses the environment-derived fallback until a saved value exists', async () => {
        await expect(readBackendSettings(settingsPath, createBackendSettings(2))).resolves.toEqual({
            downloads: { maxConcurrentDownloads: 2 }
        });

        const store = new BackendSettingsStore({ filePath: settingsPath });
        await store.save(createBackendSettings(4));
        await store.save(createBackendSettings(3));
        await expect(store.load(createBackendSettings(1))).resolves.toEqual({
            downloads: { maxConcurrentDownloads: 3 }
        });

        const document = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        expect(document.version).toBe(SETTINGS_STORE_VERSION);
        expect(document.updatedAt).toEqual(expect.any(String));
    });

    test('rejects invalid concurrency values instead of persisting them', async () => {
        await expect(writeBackendSettings(settingsPath, {
            downloads: { maxConcurrentDownloads: 0 }
        })).rejects.toMatchObject({ code: 'BACKEND_SETTINGS_INVALID' });
        expect(fs.existsSync(settingsPath)).toBe(false);
    });

    test('persists custom and unlimited concurrency values', async () => {
        await expect(writeBackendSettings(settingsPath, {
            downloads: { maxConcurrentDownloads: 128 }
        })).resolves.toEqual({ downloads: { maxConcurrentDownloads: 128 } });

        await expect(writeBackendSettings(settingsPath, {
            downloads: { maxConcurrentDownloads: 'unlimited' }
        })).resolves.toEqual({ downloads: { maxConcurrentDownloads: 'unlimited' } });
        await expect(readBackendSettings(settingsPath, createBackendSettings(2))).resolves.toEqual({
            downloads: { maxConcurrentDownloads: 'unlimited' }
        });
    });

    test('rejects malformed or unsupported saved settings', async () => {
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, '{not json', 'utf8');
        await expect(readBackendSettings(settingsPath, createBackendSettings(2))).rejects.toMatchObject({
            code: 'BACKEND_SETTINGS_INVALID'
        });

        fs.writeFileSync(settingsPath, JSON.stringify({ version: 999, settings: createBackendSettings(2) }), 'utf8');
        await expect(readBackendSettings(settingsPath, createBackendSettings(2))).rejects.toMatchObject({
            code: 'BACKEND_SETTINGS_UNSUPPORTED'
        });
    });
});
