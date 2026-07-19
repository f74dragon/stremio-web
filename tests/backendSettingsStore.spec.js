/* global describe, beforeEach, afterEach, test, expect */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    SETTINGS_STORE_VERSION,
    LEGACY_SETTINGS_STORE_VERSION,
    ALLDEBRID_SETTINGS_STORE_VERSION,
    PLAYER_SETTINGS_STORE_VERSION,
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
            downloads: { maxConcurrentDownloads: 2 },
            player: { executablePath: null },
            debrid: { allDebrid: null, realDebrid: null }
        });

        const store = new BackendSettingsStore({ filePath: settingsPath });
        await store.save(createBackendSettings(4));
        await store.save(createBackendSettings(3));
        await expect(store.load(createBackendSettings(1))).resolves.toEqual({
            downloads: { maxConcurrentDownloads: 3 },
            player: { executablePath: null },
            debrid: { allDebrid: null, realDebrid: null }
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
        })).resolves.toEqual({ downloads: { maxConcurrentDownloads: 128 }, player: { executablePath: null }, debrid: { allDebrid: null, realDebrid: null } });

        await expect(writeBackendSettings(settingsPath, {
            downloads: { maxConcurrentDownloads: 'unlimited' }
        })).resolves.toEqual({ downloads: { maxConcurrentDownloads: 'unlimited' }, player: { executablePath: null }, debrid: { allDebrid: null, realDebrid: null } });
        await expect(readBackendSettings(settingsPath, createBackendSettings(2))).resolves.toEqual({
            downloads: { maxConcurrentDownloads: 'unlimited' },
            player: { executablePath: null },
            debrid: { allDebrid: null, realDebrid: null }
        });
    });

    test('persists backend-only AllDebrid credentials and migrates version one settings', async () => {
        const settings = createBackendSettings(2, {
            apiKey: 'secret-api-key',
            username: 'viewer',
            isPremium: true,
            premiumUntil: 1900000000
        });
        await expect(writeBackendSettings(settingsPath, settings)).resolves.toEqual({
            downloads: { maxConcurrentDownloads: 2 },
            player: { executablePath: null },
            debrid: {
                allDebrid: {
                    apiKey: 'secret-api-key',
                    username: 'viewer',
                    isPremium: true,
                    premiumUntil: '1900000000'
                },
                realDebrid: null
            }
        });

        fs.writeFileSync(settingsPath, JSON.stringify({
            version: LEGACY_SETTINGS_STORE_VERSION,
            settings: { downloads: { maxConcurrentDownloads: 4 } }
        }), 'utf8');
        await expect(readBackendSettings(settingsPath, createBackendSettings(1))).resolves.toEqual({
            downloads: { maxConcurrentDownloads: 4 },
            player: { executablePath: null },
            debrid: { allDebrid: null, realDebrid: null }
        });

        fs.writeFileSync(settingsPath, JSON.stringify({
            version: ALLDEBRID_SETTINGS_STORE_VERSION,
            settings
        }), 'utf8');
        await expect(readBackendSettings(settingsPath, createBackendSettings(1, null, 'C:\\Players\\mpc-hc64.exe'))).resolves.toMatchObject({
            downloads: { maxConcurrentDownloads: 2 },
            player: { executablePath: 'C:\\Players\\mpc-hc64.exe' },
            debrid: { allDebrid: { apiKey: 'secret-api-key' } }
        });

        fs.writeFileSync(settingsPath, JSON.stringify({
            version: PLAYER_SETTINGS_STORE_VERSION,
            settings: createBackendSettings(2, null, 'C:\\Players\\mpc-hc64.exe')
        }), 'utf8');
        await expect(readBackendSettings(settingsPath, createBackendSettings(1))).resolves.toEqual({
            downloads: { maxConcurrentDownloads: 2 },
            player: { executablePath: 'C:\\Players\\mpc-hc64.exe' },
            debrid: { allDebrid: null, realDebrid: null }
        });
    });

    test('persists backend-only Real-Debrid OAuth credentials', async () => {
        const realDebrid = {
            clientId: 'bound-client-id',
            clientSecret: 'bound-client-secret',
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
            tokenExpiresAt: '2030-01-01T00:00:00.000Z',
            userId: 42,
            username: 'viewer',
            isPremium: true,
            premiumUntil: '2031-01-01T00:00:00.000Z'
        };
        await expect(writeBackendSettings(settingsPath, createBackendSettings(2, null, null, realDebrid))).resolves.toEqual({
            downloads: { maxConcurrentDownloads: 2 },
            player: { executablePath: null },
            debrid: {
                allDebrid: null,
                realDebrid: { ...realDebrid, userId: '42' }
            }
        });

        expect(() => createBackendSettings(2, null, null, {
            ...realDebrid,
            refreshToken: ''
        })).toThrow(expect.objectContaining({ code: 'BACKEND_SETTINGS_INVALID' }));
    });

    test('persists a validated player executable path', async () => {
        const executablePath = 'C:\\Program Files\\MPC-HC\\mpc-hc64.exe';
        await expect(writeBackendSettings(settingsPath, createBackendSettings(2, null, executablePath))).resolves.toEqual({
            downloads: { maxConcurrentDownloads: 2 },
            player: { executablePath },
            debrid: { allDebrid: null, realDebrid: null }
        });
        await expect(writeBackendSettings(settingsPath, {
            downloads: { maxConcurrentDownloads: 2 },
            player: { executablePath: 'relative-player.exe' },
            debrid: { allDebrid: null, realDebrid: null }
        })).rejects.toMatchObject({
            code: 'BACKEND_SETTINGS_INVALID'
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
