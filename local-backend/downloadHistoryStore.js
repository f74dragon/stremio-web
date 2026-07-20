const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getDefaultDataDirectory } = require('./downloadRecordStore');

const HISTORY_SCHEMA_VERSION = 1;
const HISTORY_FILE_NAME = 'download-history.ndjson';
const DEFAULT_HISTORY_LIMIT = 200;
const MAX_HISTORY_LIMIT = 1000;
const MAX_TEXT_LENGTH = 512;
const VALID_EVENT_TYPES = new Set([
    'download_created',
    'download_started',
    'download_paused',
    'download_resumed',
    'download_retried',
    'download_completed',
    'download_failed',
    'download_canceled',
    'download_interrupted',
    'record_backfilled',
    'record_removal_requested',
    'record_removed',
    'media_deletion_requested',
    'media_deleted'
]);
const STATUS_EVENT_TYPES = Object.freeze({
    downloading: 'download_started',
    paused: 'download_paused',
    completed: 'download_completed',
    failed: 'download_failed',
    canceled: 'download_canceled'
});

const getDefaultHistoryPath = () => path.join(getDefaultDataDirectory(), HISTORY_FILE_NAME);

const sanitizeDisplayText = (value, maxLength = MAX_TEXT_LENGTH) => {
    if (typeof value !== 'string') {
        return null;
    }

    const sanitized = value
        .replace(/https?:\/\/\S+/gi, '[link removed]')
        .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|auth(?:orization)?)[\s=:]+[^\s,;]+/gi, '$1=[redacted]')
        .replace(/\p{Cc}/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return sanitized ? sanitized.slice(0, maxLength) : null;
};

const sanitizeIdentifier = (value, maxLength = 256) => {
    if (typeof value !== 'string') {
        return null;
    }
    const sanitized = value.trim().replace(/[^a-zA-Z0-9:._-]/g, '').slice(0, maxLength);
    return sanitized || null;
};

const sanitizeArtworkUrl = (value) => {
    if (typeof value !== 'string' || !value) {
        return null;
    }
    try {
        const parsed = new URL(value);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return null;
        }
        parsed.username = '';
        parsed.password = '';
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString().slice(0, 2048);
    } catch {
        return null;
    }
};

const getBaseFileName = (value) => {
    if (typeof value !== 'string' || !value) {
        return null;
    }
    return path.win32.basename(path.posix.basename(value));
};

const safeInteger = (value) => {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    return Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
};

const createHistoryRecordSnapshot = (record) => {
    const storedSnapshot = record?.media && record?.source && record?.result ? record : null;
    const media = storedSnapshot?.media || record;
    const source = storedSnapshot?.source || record;
    const result = storedSnapshot?.result || record;
    const localFileName = storedSnapshot ? null : getBaseFileName(record?.localPath);
    const partialFileName = storedSnapshot ? null : getBaseFileName(record?.partialPath);
    const sourceFileName = getBaseFileName(source?.fileName);
    return {
        media: {
            metaId: sanitizeIdentifier(media?.metaId),
            type: sanitizeIdentifier(media?.type, 32),
            title: sanitizeDisplayText(media?.title ?? media?.parentTitle ?? media?.videoTitle),
            videoId: sanitizeIdentifier(media?.videoId),
            videoTitle: sanitizeDisplayText(media?.videoTitle),
            season: safeInteger(media?.season),
            episode: safeInteger(media?.episode),
            poster: sanitizeArtworkUrl(media?.poster)
        },
        source: {
            addonName: sanitizeDisplayText(source?.addonName, 128),
            provider: sanitizeIdentifier(source?.provider ?? source?.debridProvider, 32),
            streamName: sanitizeDisplayText(source?.streamName, 256),
            fileName: sanitizeDisplayText(localFileName || partialFileName || sourceFileName, 256)
        },
        result: {
            status: sanitizeIdentifier(result?.status, 32),
            errorCode: sanitizeIdentifier(result?.errorCode, 128),
            bytesDownloaded: safeInteger(result?.bytesDownloaded),
            bytesTotal: safeInteger(result?.bytesTotal),
            attemptCount: safeInteger(result?.attemptCount),
            createdAt: normalizeIsoDate(result?.createdAt),
            completedAt: normalizeIsoDate(result?.completedAt)
        }
    };
};

const normalizeIsoDate = (value, fallback = null) => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
};

const createHistoryDetails = (details) => ({
    previousStatus: sanitizeIdentifier(details?.previousStatus, 32),
    status: sanitizeIdentifier(details?.status, 32),
    resumeOffset: safeInteger(details?.resumeOffset),
    bytesFreed: safeInteger(details?.bytesFreed),
    deletedFileCount: safeInteger(details?.deletedFileCount),
    remainingSharedRecordCount: safeInteger(details?.remainingSharedRecordCount)
});

const normalizeHistoryEvent = (input, { now = () => new Date().toISOString(), idFactory = () => crypto.randomUUID() } = {}) => {
    const eventType = typeof input?.eventType === 'string' ? input.eventType : '';
    const downloadId = sanitizeIdentifier(input?.downloadId || input?.record?.id);
    if (!VALID_EVENT_TYPES.has(eventType) || !downloadId) {
        throw new Error('Invalid download history event');
    }

    return {
        schemaVersion: HISTORY_SCHEMA_VERSION,
        eventId: sanitizeIdentifier(input?.eventId) || `history_${sanitizeIdentifier(idFactory())}`,
        eventKey: sanitizeIdentifier(input?.eventKey) || null,
        eventType,
        downloadId,
        occurredAt: normalizeIsoDate(input?.occurredAt, normalizeIsoDate(now(), new Date().toISOString())),
        record: createHistoryRecordSnapshot(input.record),
        details: createHistoryDetails(input.details)
    };
};

const parseHistoryContents = (contents, { onWarning = () => undefined } = {}) => {
    const events = [];
    let invalidEntryCount = 0;
    String(contents || '').split(/\r?\n/).forEach((line, index) => {
        if (!line.trim()) {
            return;
        }
        try {
            const parsed = JSON.parse(line);
            if (parsed?.schemaVersion !== HISTORY_SCHEMA_VERSION) {
                throw new Error('unsupported schema version');
            }
            events.push(normalizeHistoryEvent(parsed, {
                now: () => parsed.occurredAt,
                idFactory: () => parsed.eventId
            }));
        } catch (error) {
            invalidEntryCount += 1;
            onWarning(`Ignoring invalid download history entry on line ${index + 1}: ${error.message}`);
        }
    });
    return { events, invalidEntryCount };
};

class DownloadHistoryStore {
    constructor({
        filePath = getDefaultHistoryPath(),
        now = () => new Date().toISOString(),
        idFactory = () => crypto.randomUUID(),
        onWarning = (message) => console.warn(message)
    } = {}) {
        this.filePath = path.resolve(filePath);
        this.now = now;
        this.idFactory = idFactory;
        this.onWarning = onWarning;
        this.events = [];
        this.eventKeys = new Set();
        this.invalidEntryCount = 0;
        this.initializationPromise = null;
        this.operationQueue = Promise.resolve();
    }

    async initializeUnsafe() {
        let contents = '';
        try {
            contents = await fs.promises.readFile(this.filePath, 'utf8');
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                throw error;
            }
        }

        const parsed = parseHistoryContents(contents, { onWarning: this.onWarning });
        this.events = parsed.events;
        this.eventKeys = new Set(parsed.events.map(({ eventKey }) => eventKey).filter(Boolean));
        this.invalidEntryCount = parsed.invalidEntryCount;

        if (contents && !contents.endsWith('\n')) {
            await fs.promises.appendFile(this.filePath, '\n', 'utf8');
        }
        return parsed;
    }

    initialize() {
        if (!this.initializationPromise) {
            this.initializationPromise = this.initializeUnsafe();
        }
        return this.initializationPromise;
    }

    enqueue(operation) {
        const result = this.operationQueue.then(operation);
        this.operationQueue = result.catch(() => undefined);
        return result;
    }

    async append(input) {
        await this.initialize();
        return this.enqueue(async () => {
            const event = normalizeHistoryEvent(input, { now: this.now, idFactory: this.idFactory });
            if (event.eventKey && this.eventKeys.has(event.eventKey)) {
                return this.events.find(({ eventKey }) => eventKey === event.eventKey) || null;
            }

            await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
            await fs.promises.appendFile(this.filePath, `${JSON.stringify(event)}\n`, 'utf8');
            this.events.push(event);
            if (event.eventKey) {
                this.eventKeys.add(event.eventKey);
            }
            return event;
        });
    }

    async backfill(records) {
        await this.initialize();
        let added = 0;
        for (const record of records || []) {
            const eventKey = `record-seen:${record?.id || ''}`;
            if (!record?.id || this.eventKeys.has(eventKey)) {
                continue;
            }
            await this.append({
                eventKey,
                eventType: 'record_backfilled',
                downloadId: record.id,
                occurredAt: record.updatedAt || record.createdAt,
                record,
                details: { status: record.status }
            });
            added += 1;
        }
        return added;
    }

    async list({ limit = DEFAULT_HISTORY_LIMIT } = {}) {
        await this.initialize();
        await this.operationQueue;
        const normalizedLimit = Math.min(MAX_HISTORY_LIMIT, Math.max(1, Number.isSafeInteger(Number(limit)) ? Number(limit) : DEFAULT_HISTORY_LIMIT));
        return {
            version: HISTORY_SCHEMA_VERSION,
            total: this.events.length,
            invalidEntryCount: this.invalidEntryCount,
            items: this.events.slice(-normalizedLimit).reverse().map((event) => JSON.parse(JSON.stringify(event)))
        };
    }

    async flush() {
        await this.initialize();
        await this.operationQueue;
    }
}

module.exports = {
    HISTORY_SCHEMA_VERSION,
    HISTORY_FILE_NAME,
    DEFAULT_HISTORY_LIMIT,
    MAX_HISTORY_LIMIT,
    VALID_EVENT_TYPES,
    STATUS_EVENT_TYPES,
    getDefaultHistoryPath,
    sanitizeDisplayText,
    sanitizeArtworkUrl,
    getBaseFileName,
    createHistoryRecordSnapshot,
    createHistoryDetails,
    normalizeHistoryEvent,
    parseHistoryContents,
    DownloadHistoryStore
};
