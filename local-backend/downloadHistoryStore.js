const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getDefaultDataDirectory } = require('./downloadRecordStore');

const HISTORY_SCHEMA_VERSION = 1;
const HISTORY_FILE_NAME = 'download-history.ndjson';
const DEFAULT_HISTORY_LIMIT = 200;
const MAX_HISTORY_LIMIT = 1000;
const HISTORY_CURSOR_VERSION = 1;
const MAX_HISTORY_CURSOR_LENGTH = 1024;
const MAX_TEXT_LENGTH = 512;
const ISO_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;
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

class DownloadHistoryQueryError extends Error {
    constructor(message, code = 'INVALID_DOWNLOAD_HISTORY_QUERY') {
        super(message);
        this.name = 'DownloadHistoryQueryError';
        this.code = code;
    }
}

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

const isLeapYear = (year) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

const getDaysInMonth = (year, month) => {
    const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return days[month - 1] || 0;
};

const normalizeHistoryDateFilter = (value, fieldName) => {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value !== 'string') {
        throw new DownloadHistoryQueryError(`${fieldName} must be a valid ISO-8601 date-time`, 'INVALID_HISTORY_DATE');
    }

    const match = ISO_DATE_TIME_PATTERN.exec(value);
    if (!match) {
        throw new DownloadHistoryQueryError(`${fieldName} must be a valid ISO-8601 date-time`, 'INVALID_HISTORY_DATE');
    }

    const [, yearText, monthText, dayText, hourText, minuteText, secondText, , timezone] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    if (
        month < 1 || month > 12 ||
        day < 1 || day > getDaysInMonth(year, month) ||
        hour > 23 || minute > 59 || second > 59
    ) {
        throw new DownloadHistoryQueryError(`${fieldName} must be a valid ISO-8601 date-time`, 'INVALID_HISTORY_DATE');
    }
    if (timezone !== 'Z') {
        const timezoneHour = Number(timezone.slice(1, 3));
        const timezoneMinute = Number(timezone.slice(4, 6));
        if (timezoneHour > 14 || timezoneMinute > 59 || (timezoneHour === 14 && timezoneMinute !== 0)) {
            throw new DownloadHistoryQueryError(`${fieldName} must be a valid ISO-8601 date-time`, 'INVALID_HISTORY_DATE');
        }
    }

    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
        throw new DownloadHistoryQueryError(`${fieldName} must be a valid ISO-8601 date-time`, 'INVALID_HISTORY_DATE');
    }
    return new Date(timestamp).toISOString();
};

const normalizeHistoryRange = ({ from, to } = {}) => {
    const normalizedFrom = normalizeHistoryDateFilter(from, 'from');
    const normalizedTo = normalizeHistoryDateFilter(to, 'to');
    const fromTimestamp = normalizedFrom === null ? null : Date.parse(normalizedFrom);
    const toTimestamp = normalizedTo === null ? null : Date.parse(normalizedTo);
    if (fromTimestamp !== null && toTimestamp !== null && fromTimestamp > toTimestamp) {
        throw new DownloadHistoryQueryError('from must be earlier than or equal to to', 'INVALID_HISTORY_DATE_RANGE');
    }
    return {
        from: normalizedFrom,
        to: normalizedTo,
        fromTimestamp,
        toTimestamp
    };
};

const encodeHistoryCursor = ({ nextIndex, nextEventId, snapshotIndex, snapshotEventId, from, to }) => Buffer.from(JSON.stringify({
    v: HISTORY_CURSOR_VERSION,
    n: nextIndex,
    e: nextEventId,
    s: snapshotIndex,
    a: snapshotEventId,
    f: from,
    t: to
}), 'utf8').toString('base64url');

const decodeHistoryCursor = (value) => {
    if (
        typeof value !== 'string' ||
        value.length < 1 ||
        value.length > MAX_HISTORY_CURSOR_LENGTH ||
        !/^[a-zA-Z0-9_-]+$/.test(value)
    ) {
        throw new DownloadHistoryQueryError('cursor is invalid', 'INVALID_HISTORY_CURSOR');
    }

    let parsed;
    try {
        const decoded = Buffer.from(value, 'base64url');
        if (decoded.toString('base64url') !== value) {
            throw new Error('non-canonical cursor');
        }
        parsed = JSON.parse(decoded.toString('utf8'));
    } catch {
        throw new DownloadHistoryQueryError('cursor is invalid', 'INVALID_HISTORY_CURSOR');
    }

    if (
        parsed?.v !== HISTORY_CURSOR_VERSION ||
        !Number.isSafeInteger(parsed?.n) || parsed.n < 0 ||
        typeof parsed?.e !== 'string' || !parsed.e || parsed.e.length > 256 ||
        !Number.isSafeInteger(parsed?.s) || parsed.s < parsed.n ||
        typeof parsed?.a !== 'string' || !parsed.a || parsed.a.length > 256 ||
        !Object.prototype.hasOwnProperty.call(parsed, 'f') || (parsed.f !== null && typeof parsed.f !== 'string') ||
        !Object.prototype.hasOwnProperty.call(parsed, 't') || (parsed.t !== null && typeof parsed.t !== 'string')
    ) {
        throw new DownloadHistoryQueryError('cursor is invalid', 'INVALID_HISTORY_CURSOR');
    }
    return parsed;
};

const isTimestampInHistoryRange = (timestamp, range) => (
    (range.fromTimestamp === null || timestamp >= range.fromTimestamp) &&
    (range.toTimestamp === null || timestamp <= range.toTimestamp)
);

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
        this.eventTimestamps = [];
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
        this.eventTimestamps = parsed.events.map(({ occurredAt }) => Date.parse(occurredAt));
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
            this.eventTimestamps.push(Date.parse(event.occurredAt));
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

    async list({ limit = DEFAULT_HISTORY_LIMIT, cursor, from, to } = {}) {
        await this.initialize();
        await this.operationQueue;
        const normalizedLimit = Math.min(MAX_HISTORY_LIMIT, Math.max(1, Number.isSafeInteger(Number(limit)) ? Number(limit) : DEFAULT_HISTORY_LIMIT));
        const range = normalizeHistoryRange({ from, to });
        let snapshotIndex = this.events.length - 1;
        let nextIndex = snapshotIndex;

        if (cursor !== undefined && cursor !== null) {
            const decodedCursor = decodeHistoryCursor(cursor);
            if (decodedCursor.f !== range.from || decodedCursor.t !== range.to) {
                throw new DownloadHistoryQueryError('cursor does not match the requested date range', 'HISTORY_CURSOR_FILTER_MISMATCH');
            }
            if (
                decodedCursor.s >= this.events.length ||
                this.events[decodedCursor.s]?.eventId !== decodedCursor.a ||
                this.events[decodedCursor.n]?.eventId !== decodedCursor.e
            ) {
                throw new DownloadHistoryQueryError('cursor no longer matches the download history archive', 'STALE_HISTORY_CURSOR');
            }
            snapshotIndex = decodedCursor.s;
            nextIndex = decodedCursor.n;
        }

        let filteredTotal = 0;
        for (let index = 0; index <= snapshotIndex; index += 1) {
            if (isTimestampInHistoryRange(this.eventTimestamps[index], range)) {
                filteredTotal += 1;
            }
        }

        const items = [];
        let followingIndex = null;
        for (let index = nextIndex; index >= 0; index -= 1) {
            if (!isTimestampInHistoryRange(this.eventTimestamps[index], range)) {
                continue;
            }
            if (items.length === normalizedLimit) {
                followingIndex = index;
                break;
            }
            items.push(JSON.parse(JSON.stringify(this.events[index])));
        }

        // Cursors use immutable append indexes and retain the first page's archive
        // boundary. New events can be appended safely without reshuffling later pages.
        const nextCursor = followingIndex === null ? null : encodeHistoryCursor({
            nextIndex: followingIndex,
            nextEventId: this.events[followingIndex].eventId,
            snapshotIndex,
            snapshotEventId: this.events[snapshotIndex].eventId,
            from: range.from,
            to: range.to
        });
        return {
            version: HISTORY_SCHEMA_VERSION,
            total: snapshotIndex + 1,
            filteredTotal,
            invalidEntryCount: this.invalidEntryCount,
            items,
            hasMore: nextCursor !== null,
            nextCursor
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
    HISTORY_CURSOR_VERSION,
    VALID_EVENT_TYPES,
    STATUS_EVENT_TYPES,
    getDefaultHistoryPath,
    sanitizeDisplayText,
    sanitizeArtworkUrl,
    getBaseFileName,
    createHistoryRecordSnapshot,
    createHistoryDetails,
    normalizeHistoryEvent,
    normalizeHistoryDateFilter,
    normalizeHistoryRange,
    encodeHistoryCursor,
    decodeHistoryCursor,
    parseHistoryContents,
    DownloadHistoryQueryError,
    DownloadHistoryStore
};
