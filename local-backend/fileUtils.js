const fs = require('fs');
const os = require('os');
const path = require('path');

const SUPPORTED_VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v', '.ts']);
const GENERIC_FILE_NAMES = new Set(['playlist', 'index', 'master']);
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

const collapseWhitespace = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const sanitizeWindowsName = (value, fallback = 'Unknown') => {
    const collapsedValue = collapseWhitespace(value);
    const sanitizedValue = collapsedValue
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
        .replace(/\.+$/g, '')
        .trim()
        .replace(/[. ]+$/g, '');

    const safeValue = sanitizedValue.length > 0 ? sanitizedValue : fallback;
    return WINDOWS_RESERVED_NAMES.test(safeValue) ? `${safeValue}_` : safeValue;
};

const getDefaultDownloadsRoot = () => {
    return process.env.CUSTOM_STREMIO_DOWNLOAD_DIR ||
        path.join(os.homedir(), 'Downloads', 'Stremio Downloads');
};

const zeroPad = (value) => String(value).padStart(2, '0');

const getExtensionFromSourceUrl = (sourceUrl) => {
    if (!sourceUrl) {
        return null;
    }

    try {
        const parsedUrl = new URL(sourceUrl);
        const extension = path.extname(parsedUrl.pathname || '').toLowerCase();
        return SUPPORTED_VIDEO_EXTENSIONS.has(extension) ? extension : null;
    } catch {
        return null;
    }
};

const isTrustedFileName = (fileName) => {
    if (!fileName) {
        return false;
    }

    const parsedName = path.parse(fileName);
    const extension = parsedName.ext.toLowerCase();
    if (!SUPPORTED_VIDEO_EXTENSIONS.has(extension)) {
        return false;
    }

    return !GENERIC_FILE_NAMES.has(parsedName.name.toLowerCase());
};

const getTrustedFileNameExtension = (fileName) => {
    return isTrustedFileName(fileName) ? path.extname(fileName).toLowerCase() : null;
};

const getMovieBaseName = (record) => {
    return sanitizeWindowsName(record?.parentTitle || record?.videoTitle || record?.streamName || record?.metaId || 'Movie', 'Movie');
};

const getSeriesBaseName = (record) => {
    const season = typeof record?.season === 'number' ? zeroPad(record.season) : '00';
    const episode = typeof record?.episode === 'number' ? zeroPad(record.episode) : '00';
    const episodeTitle = sanitizeWindowsName(record?.videoTitle || record?.streamName || record?.metaId || 'Episode', 'Episode');
    return `S${season}E${episode} - ${episodeTitle}`;
};

const getContainerFolderName = (record) => {
    return sanitizeWindowsName(record?.parentTitle || record?.videoTitle || record?.streamName || record?.metaId || 'Unknown Title', 'Unknown Title');
};

const getSeasonFolderName = (record) => {
    return `Season ${typeof record?.season === 'number' ? zeroPad(record.season) : '00'}`;
};

const deriveLocalPath = (record) => {
    const downloadsRoot = getDefaultDownloadsRoot();
    const urlExtension = getExtensionFromSourceUrl(record?.sourceUrl);
    const trustedFileNameExtension = getTrustedFileNameExtension(record?.fileName);
    const extension = urlExtension || trustedFileNameExtension || '.mp4';
    const containerFolderName = getContainerFolderName(record);
    const fileBaseName = record?.type === 'series' ? getSeriesBaseName(record) : getMovieBaseName(record);
    const fileName = `${fileBaseName}${extension}`;

    return record?.type === 'series' ?
        path.join(downloadsRoot, containerFolderName, getSeasonFolderName(record), fileName)
        :
        path.join(downloadsRoot, containerFolderName, fileName);
};

const ensureParentDirectory = async (filePath) => {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
};

const derivePartialPath = (localPath) => `${localPath}.part`;

const createFileIdentity = (stats) => ({
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    birthtimeMs: stats.birthtimeMs
});

const isSameFileIdentity = (expected, actual) => {
    return Boolean(expected && actual) &&
        expected.dev === actual.dev &&
        expected.ino === actual.ino &&
        expected.size === actual.size &&
        expected.mtimeMs === actual.mtimeMs &&
        expected.birthtimeMs === actual.birthtimeMs;
};

const getRegularFileIdentity = async (filePath, { allowMissing = false } = {}) => {
    let stats;
    try {
        stats = await fs.promises.lstat(filePath);
    } catch (error) {
        if (allowMissing && error?.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
        const error = new Error(`The download artifact is not a regular file: ${filePath}`);
        error.code = 'DOWNLOAD_ARTIFACT_INVALID';
        throw error;
    }
    return createFileIdentity(stats);
};

const finalizePartialDownload = async (partialPath, localPath, expectedBytes) => {
    const partialStats = await fs.promises.lstat(partialPath);
    if (!partialStats.isFile() || partialStats.isSymbolicLink()) {
        const error = new Error(`The completed download is not a regular file: ${partialPath}`);
        error.code = 'DOWNLOAD_ARTIFACT_INVALID';
        throw error;
    }
    if (Number.isSafeInteger(expectedBytes) && partialStats.size !== expectedBytes) {
        throw new Error(`The completed download contains ${partialStats.size} of ${expectedBytes} expected bytes`);
    }

    try {
        await fs.promises.lstat(localPath);
        const error = new Error(`The final download destination already exists and will not be overwritten: ${localPath}`);
        error.code = 'DOWNLOAD_DESTINATION_EXISTS';
        throw error;
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            throw error;
        }
    }
    await fs.promises.rename(partialPath, localPath);
    return getRegularFileIdentity(localPath);
};

module.exports = {
    SUPPORTED_VIDEO_EXTENSIONS,
    sanitizeWindowsName,
    getDefaultDownloadsRoot,
    deriveLocalPath,
    ensureParentDirectory,
    derivePartialPath,
    createFileIdentity,
    isSameFileIdentity,
    getRegularFileIdentity,
    finalizePartialDownload
};
