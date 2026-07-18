const fs = require('fs');
const path = require('path');
const { getDefaultDataDirectory } = require('./downloadRecordStore');
const { isValidMaxConcurrentDownloads } = require('./downloadScheduler');

const SETTINGS_STORE_VERSION = 2;
const LEGACY_SETTINGS_STORE_VERSION = 1;
const SETTINGS_FILE_NAME = 'backend-settings.json';

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

const createBackendSettings = (maxConcurrentDownloads, allDebrid = null) => ({
    downloads: {
        maxConcurrentDownloads
    },
    debrid: {
        allDebrid: normalizeAllDebridSettings(allDebrid)
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

    return createBackendSettings(maxConcurrentDownloads, settings?.debrid?.allDebrid ?? null);
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

        if (!document || typeof document !== 'object' || ![LEGACY_SETTINGS_STORE_VERSION, SETTINGS_STORE_VERSION].includes(document.version)) {
            const formatError = new Error(`Backend settings use an unsupported format: ${filePath}`);
            formatError.code = 'BACKEND_SETTINGS_UNSUPPORTED';
            throw formatError;
        }

        return validateBackendSettings(document.settings);
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
    SETTINGS_FILE_NAME,
    createBackendSettings,
    getDefaultSettingsPath,
    validateBackendSettings,
    readBackendSettings,
    writeBackendSettings,
    BackendSettingsStore
};
