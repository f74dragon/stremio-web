const fs = require('fs');
const path = require('path');
const { getDefaultDataDirectory } = require('./downloadRecordStore');
const { isValidMaxConcurrentDownloads } = require('./downloadScheduler');

const SETTINGS_STORE_VERSION = 6;
const LEGACY_SETTINGS_STORE_VERSION = 1;
const ALLDEBRID_SETTINGS_STORE_VERSION = 2;
const PLAYER_SETTINGS_STORE_VERSION = 3;
const REALDEBRID_SETTINGS_STORE_VERSION = 4;
const PLAYBACK_PROGRESS_SETTINGS_STORE_VERSION = 5;
const WATCHED_SYNC_SETTINGS_STORE_VERSION = 6;
const SETTINGS_FILE_NAME = 'backend-settings.json';
const DEFAULT_MPC_HC_WEB_PORT = 13579;

const normalizeAllDebridSettings = (settings) => {
    if (settings === null || settings === undefined) {
        return null;
    }

    const apiKey = typeof settings.apiKey === 'string' ? settings.apiKey.trim() : '';
    if (!apiKey) {
        const error = new Error('Backend settings contain an invalid AllDebrid API key');
        error.code = 'BACKEND_SETTINGS_INVALID';
        throw error;
    }

    return {
        apiKey,
        username: typeof settings.username === 'string' && settings.username.trim() ? settings.username.trim() : null,
        isPremium: settings.isPremium === true,
        premiumUntil: settings.premiumUntil === null || settings.premiumUntil === undefined ? null : String(settings.premiumUntil)
    };
};

const normalizeRealDebridSettings = (settings) => {
    if (settings === null || settings === undefined) {
        return null;
    }

    const requiredValues = ['clientId', 'clientSecret', 'accessToken', 'refreshToken'];
    const normalized = Object.fromEntries(requiredValues.map((key) => [
        key,
        typeof settings[key] === 'string' ? settings[key].trim() : ''
    ]));
    if (requiredValues.some((key) => !normalized[key]) || !Number.isFinite(Date.parse(settings.tokenExpiresAt))) {
        const error = new Error('Backend settings contain invalid Real-Debrid credentials');
        error.code = 'BACKEND_SETTINGS_INVALID';
        throw error;
    }

    return {
        ...normalized,
        tokenExpiresAt: new Date(Date.parse(settings.tokenExpiresAt)).toISOString(),
        userId: settings.userId === null || settings.userId === undefined ? null : String(settings.userId),
        username: typeof settings.username === 'string' && settings.username.trim() ? settings.username.trim() : null,
        isPremium: settings.isPremium === true,
        premiumUntil: settings.premiumUntil === null || settings.premiumUntil === undefined ? null : String(settings.premiumUntil)
    };
};

const normalizePlayerExecutablePath = (value) => {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const executablePath = typeof value === 'string' ? value.trim() : '';
    const isAbsolute = path.isAbsolute(executablePath) || path.win32.isAbsolute(executablePath);
    if (!isAbsolute || path.extname(executablePath).toLowerCase() !== '.exe') {
        const error = new Error('Backend settings contain an invalid player executable path');
        error.code = 'BACKEND_SETTINGS_INVALID';
        throw error;
    }
    return executablePath;
};

const normalizePlayerProgressTracking = (settings) => {
    const enabled = settings?.enabled === true;
    const port = settings?.port === undefined || settings?.port === null || settings?.port === '' ?
        DEFAULT_MPC_HC_WEB_PORT
        : Number(settings.port);
    const localhostOnlyConfirmed = settings?.localhostOnlyConfirmed === true;
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
        const error = new Error('Backend settings contain an invalid MPC-HC Web Interface port');
        error.code = 'BACKEND_SETTINGS_INVALID';
        throw error;
    }
    if (enabled && !localhostOnlyConfirmed) {
        const error = new Error('Confirm that MPC-HC allows Web Interface access from localhost only before enabling progress tracking');
        error.code = 'BACKEND_SETTINGS_INVALID';
        throw error;
    }
    return {
        enabled,
        port,
        localhostOnlyConfirmed,
        watchedSyncEnabled: enabled && settings?.watchedSyncEnabled === true
    };
};

const createBackendSettings = (
    maxConcurrentDownloads,
    allDebrid = null,
    playerExecutablePath = null,
    realDebrid = null,
    playerProgressTracking = null
) => ({
    downloads: {
        maxConcurrentDownloads
    },
    player: {
        executablePath: normalizePlayerExecutablePath(playerExecutablePath),
        progressTracking: normalizePlayerProgressTracking(playerProgressTracking)
    },
    debrid: {
        allDebrid: normalizeAllDebridSettings(allDebrid),
        realDebrid: normalizeRealDebridSettings(realDebrid)
    }
});

const getDefaultSettingsPath = () => path.join(getDefaultDataDirectory(), SETTINGS_FILE_NAME);

const validateBackendSettings = (settings) => {
    const maxConcurrentDownloads = settings?.downloads?.maxConcurrentDownloads;
    if (!isValidMaxConcurrentDownloads(maxConcurrentDownloads)) {
        const error = new Error('Backend settings contain an invalid maximum concurrent downloads value');
        error.code = 'BACKEND_SETTINGS_INVALID';
        throw error;
    }

    return createBackendSettings(
        maxConcurrentDownloads,
        settings?.debrid?.allDebrid ?? null,
        settings?.player?.executablePath ?? null,
        settings?.debrid?.realDebrid ?? null,
        settings?.player?.progressTracking ?? null
    );
};

const readBackendSettings = async (filePath = getDefaultSettingsPath(), fallbackSettings) => {
    try {
        const contents = await fs.promises.readFile(filePath, 'utf8');
        let document;
        try {
            document = JSON.parse(contents);
        } catch (error) {
            const parseError = new Error(`Backend settings are not valid JSON: ${filePath}`);
            parseError.code = 'BACKEND_SETTINGS_INVALID';
            parseError.cause = error;
            throw parseError;
        }

        if (!document || typeof document !== 'object' || ![
            LEGACY_SETTINGS_STORE_VERSION,
            ALLDEBRID_SETTINGS_STORE_VERSION,
            PLAYER_SETTINGS_STORE_VERSION,
            REALDEBRID_SETTINGS_STORE_VERSION,
            PLAYBACK_PROGRESS_SETTINGS_STORE_VERSION,
            SETTINGS_STORE_VERSION
        ].includes(document.version)) {
            const formatError = new Error(`Backend settings use an unsupported format: ${filePath}`);
            formatError.code = 'BACKEND_SETTINGS_UNSUPPORTED';
            throw formatError;
        }

        const settings = {
            ...document.settings,
            player: {
                executablePath: document.version >= PLAYER_SETTINGS_STORE_VERSION ?
                    document.settings?.player?.executablePath ?? null
                    :
                    fallbackSettings?.player?.executablePath ?? null,
                progressTracking: document.version >= PLAYBACK_PROGRESS_SETTINGS_STORE_VERSION ?
                    document.settings?.player?.progressTracking
                    :
                    fallbackSettings?.player?.progressTracking ?? null
            },
            debrid: {
                allDebrid: document.settings?.debrid?.allDebrid ?? null,
                realDebrid: document.version >= REALDEBRID_SETTINGS_STORE_VERSION ?
                    document.settings?.debrid?.realDebrid ?? null
                    :
                    null
            }
        };
        return validateBackendSettings(settings);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return validateBackendSettings(fallbackSettings);
        }
        throw error;
    }
};

const writeBackendSettings = async (filePath, settings) => {
    const validatedSettings = validateBackendSettings(settings);
    const directoryPath = path.dirname(filePath);
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const document = {
        version: SETTINGS_STORE_VERSION,
        updatedAt: new Date().toISOString(),
        settings: validatedSettings
    };

    await fs.promises.mkdir(directoryPath, { recursive: true });
    try {
        await fs.promises.writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
        await fs.promises.rename(temporaryPath, filePath);
    } catch (error) {
        try {
            await fs.promises.rm(temporaryPath, { force: true });
        } catch {
            // Preserve the original write/rename failure.
        }
        throw error;
    }

    return validatedSettings;
};

class BackendSettingsStore {
    constructor({ filePath = getDefaultSettingsPath() } = {}) {
        this.filePath = path.resolve(filePath);
    }

    load(fallbackSettings) {
        return readBackendSettings(this.filePath, fallbackSettings);
    }

    save(settings) {
        return writeBackendSettings(this.filePath, settings);
    }
}

module.exports = {
    SETTINGS_STORE_VERSION,
    LEGACY_SETTINGS_STORE_VERSION,
    ALLDEBRID_SETTINGS_STORE_VERSION,
    PLAYER_SETTINGS_STORE_VERSION,
    REALDEBRID_SETTINGS_STORE_VERSION,
    PLAYBACK_PROGRESS_SETTINGS_STORE_VERSION,
    WATCHED_SYNC_SETTINGS_STORE_VERSION,
    SETTINGS_FILE_NAME,
    DEFAULT_MPC_HC_WEB_PORT,
    createBackendSettings,
    normalizeRealDebridSettings,
    normalizePlayerExecutablePath,
    normalizePlayerProgressTracking,
    getDefaultSettingsPath,
    validateBackendSettings,
    readBackendSettings,
    writeBackendSettings,
    BackendSettingsStore
};
