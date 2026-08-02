const fs = require('fs');
const path = require('path');
const { getDefaultDataDirectory } = require('./downloadRecordStore');
const { normalizeWindowsMediaPath } = require('./mpcHcStatusClient');

const PLAYBACK_PROGRESS_STORE_VERSION = 1;
const PLAYBACK_PROGRESS_FILE_NAME = 'playback-progress.json';
const VALID_PLAYBACK_STATES = new Set(['playing', 'paused', 'stopped', 'unreachable']);

const getDefaultPlaybackProgressPath = () => path.join(getDefaultDataDirectory(), PLAYBACK_PROGRESS_FILE_NAME);

const normalizeOptionalText = (value) => {
    if (value === null || value === undefined) {
        return null;
    }
    const normalized = String(value).trim();
    return normalized || null;
};

const normalizeOptionalNumber = (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;

const normalizeIsoDate = (value, fallback = null) => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
};

const createPlaybackContentKey = (record) => {
    const type = normalizeOptionalText(record?.type) || 'unknown';
    const metaId = normalizeOptionalText(record?.metaId);
    const videoId = normalizeOptionalText(record?.videoId);
    if (metaId && videoId) {
        return `${type}:${metaId}:${videoId}`;
    }
    if (metaId) {
        return `${type}:${metaId}`;
    }
    return `download:${normalizeOptionalText(record?.id) || 'unknown'}`;
};

const normalizePlaybackProgressRecord = (record) => {
    const contentKey = normalizeOptionalText(record?.contentKey);
    const downloadId = normalizeOptionalText(record?.downloadId);
    const localPath = typeof record?.localPath === 'string' && normalizeWindowsMediaPath(record.localPath) ? record.localPath : null;
    const positionMs = normalizeOptionalNumber(record?.positionMs);
    const durationMs = normalizeOptionalNumber(record?.durationMs);
    const state = VALID_PLAYBACK_STATES.has(record?.state) ? record.state : null;
    const lastObservedAt = normalizeIsoDate(record?.lastObservedAt);
    if (!contentKey || !downloadId || !localPath || positionMs === null || durationMs === null || !state || !lastObservedAt) {
        return null;
    }

    const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
    return {
        version: PLAYBACK_PROGRESS_STORE_VERSION,
        contentKey,
        downloadId,
        metaId: normalizeOptionalText(record.metaId),
        videoId: normalizeOptionalText(record.videoId),
        mediaType: normalizeOptionalText(record.mediaType),
        title: normalizeOptionalText(record.title),
        parentTitle: normalizeOptionalText(record.parentTitle),
        season: normalizeOptionalNumber(record.season),
        episode: normalizeOptionalNumber(record.episode),
        localPath,
        positionMs,
        durationMs,
        progress,
        state,
        startedAt: normalizeIsoDate(record.startedAt, lastObservedAt),
        lastObservedAt,
        lastPlayedAt: normalizeIsoDate(record.lastPlayedAt, lastObservedAt),
        sessionEndedReason: normalizeOptionalText(record.sessionEndedReason),
        player: {
            kind: 'mpc-hc',
            telemetry: 'web-interface',
            resumeOwner: 'mpc-hc-history'
        }
    };
};

const normalizePlaybackProgressRecords = (records) => {
    const byContentKey = new Map();
    if (!Array.isArray(records)) {
        return [];
    }
    records.forEach((record) => {
        const normalized = normalizePlaybackProgressRecord(record);
        if (normalized) {
            byContentKey.set(normalized.contentKey, normalized);
        }
    });
    return Array.from(byContentKey.values());
};

const parsePlaybackProgressDocument = (contents, filePath) => {
    let document;
    try {
        document = JSON.parse(contents);
    } catch (error) {
        const parseError = new Error(`Playback progress store is not valid JSON: ${filePath}`);
        parseError.code = 'PLAYBACK_PROGRESS_STORE_INVALID';
        parseError.cause = error;
        throw parseError;
    }
    if (!document || document.version !== PLAYBACK_PROGRESS_STORE_VERSION || !Array.isArray(document.records)) {
        const formatError = new Error(`Playback progress store has an unsupported format: ${filePath}`);
        formatError.code = 'PLAYBACK_PROGRESS_STORE_UNSUPPORTED';
        throw formatError;
    }
    return normalizePlaybackProgressRecords(document.records);
};

const readPlaybackProgress = async (filePath = getDefaultPlaybackProgressPath()) => {
    try {
        return parsePlaybackProgressDocument(await fs.promises.readFile(filePath, 'utf8'), filePath);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
};

const writePlaybackProgress = async (filePath, records) => {
    const directoryPath = path.dirname(filePath);
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const document = {
        version: PLAYBACK_PROGRESS_STORE_VERSION,
        updatedAt: new Date().toISOString(),
        records: normalizePlaybackProgressRecords(records)
    };
    await fs.promises.mkdir(directoryPath, { recursive: true });
    try {
        await fs.promises.writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
        await fs.promises.rename(temporaryPath, filePath);
    } catch (error) {
        await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
    }
    return document.records;
};

class PlaybackProgressStore {
    constructor({ filePath = getDefaultPlaybackProgressPath(), debounceMs = 250, onError = console.error } = {}) {
        this.filePath = path.resolve(filePath);
        this.debounceMs = debounceMs;
        this.onError = onError;
        this.records = new Map();
        this.timer = null;
        this.writePromise = null;
        this.writePending = false;
    }

    async initialize() {
        const records = await readPlaybackProgress(this.filePath);
        this.records = new Map(records.map((record) => [record.contentKey, record]));
        return this.list();
    }

    list({ metaId = null } = {}) {
        return Array.from(this.records.values())
            .filter((record) => metaId === null || record.metaId === metaId)
            .sort((first, second) => Date.parse(second.lastPlayedAt) - Date.parse(first.lastPlayedAt));
    }

    get(contentKey) {
        return this.records.get(contentKey) || null;
    }

    upsert(record) {
        const normalized = normalizePlaybackProgressRecord(record);
        if (!normalized) {
            const error = new Error('Invalid playback progress record');
            error.code = 'PLAYBACK_PROGRESS_RECORD_INVALID';
            throw error;
        }
        this.records.set(normalized.contentKey, normalized);
        this.schedule();
        return normalized;
    }

    async clear() {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.writePromise !== null) {
            await this.writePromise;
        }
        this.records.clear();
        this.writePending = true;
        await this.flush();
        return [];
    }

    schedule() {
        this.writePending = true;
        if (this.timer !== null) {
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => {
            this.timer = null;
            this.flush().catch(this.onError);
        }, this.debounceMs);
    }

    async flush() {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.writePromise !== null) {
            await this.writePromise;
            if (this.writePending) {
                await this.flush();
            }
            return;
        }
        if (!this.writePending) {
            return;
        }

        this.writePending = false;
        const records = this.list();
        this.writePromise = writePlaybackProgress(this.filePath, records);
        try {
            await this.writePromise;
        } finally {
            this.writePromise = null;
        }
        if (this.writePending) {
            await this.flush();
        }
    }
}

module.exports = {
    PLAYBACK_PROGRESS_STORE_VERSION,
    PLAYBACK_PROGRESS_FILE_NAME,
    VALID_PLAYBACK_STATES,
    getDefaultPlaybackProgressPath,
    createPlaybackContentKey,
    normalizePlaybackProgressRecord,
    normalizePlaybackProgressRecords,
    readPlaybackProgress,
    writePlaybackProgress,
    PlaybackProgressStore
};
