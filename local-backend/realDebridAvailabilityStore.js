const fs = require('fs');
const path = require('path');
const { getDefaultDataDirectory } = require('./downloadRecordStore');

const AVAILABILITY_STORE_VERSION = 1;
const AVAILABILITY_FILE_NAME = 'realdebrid-availability-history.json';
const CACHED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const UNCACHED_TTL_MS = 15 * 60 * 1000;
const UNAVAILABLE_TTL_MS = 24 * 60 * 60 * 1000;
const VALID_STATUSES = new Set(['cached', 'uncached', 'unavailable']);

const getDefaultAvailabilityPath = () => path.join(getDefaultDataDirectory(), AVAILABILITY_FILE_NAME);

const normalizeEntry = (entry) => {
    const key = typeof entry?.key === 'string' ? entry.key.trim() : '';
    const hash = typeof entry?.hash === 'string' ? entry.hash.trim().toLowerCase() : '';
    const status = typeof entry?.status === 'string' ? entry.status : '';
    const verifiedAtMs = Date.parse(entry?.verifiedAt);
    const expiresAtMs = Date.parse(entry?.expiresAt);
    if (!key || !/^[a-f0-9]{40}$/.test(hash) || !VALID_STATUSES.has(status) ||
        !Number.isFinite(verifiedAtMs) || !Number.isFinite(expiresAtMs)) {
        throw new Error('Invalid Real-Debrid availability history entry');
    }
    return {
        key,
        hash,
        fileIdx: Number.isSafeInteger(entry.fileIdx) && entry.fileIdx >= 0 ? entry.fileIdx : null,
        filename: typeof entry.filename === 'string' && entry.filename ? entry.filename : null,
        videoSize: Number.isSafeInteger(entry.videoSize) && entry.videoSize > 0 ? entry.videoSize : null,
        status,
        verifiedAt: new Date(verifiedAtMs).toISOString(),
        expiresAt: new Date(expiresAtMs).toISOString(),
        source: typeof entry.source === 'string' && entry.source ? entry.source : 'unknown'
    };
};

class RealDebridAvailabilityStore {
    constructor({ filePath = getDefaultAvailabilityPath() } = {}) {
        this.filePath = path.resolve(filePath);
        this.operationQueue = Promise.resolve();
    }

    enqueue(operation) {
        const result = this.operationQueue.then(operation);
        this.operationQueue = result.catch(() => undefined);
        return result;
    }

    async loadUnsafe() {
        try {
            const document = JSON.parse(await fs.promises.readFile(this.filePath, 'utf8'));
            if (document?.version !== AVAILABILITY_STORE_VERSION || !Array.isArray(document.entries)) {
                throw new Error(`Real-Debrid availability history uses an unsupported format: ${this.filePath}`);
            }
            return document.entries.map(normalizeEntry);
        } catch (error) {
            if (error?.code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }

    async saveUnsafe(entries) {
        const normalizedEntries = entries.map(normalizeEntry);
        const directoryPath = path.dirname(this.filePath);
        const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
        const document = {
            version: AVAILABILITY_STORE_VERSION,
            updatedAt: new Date().toISOString(),
            entries: normalizedEntries
        };
        await fs.promises.mkdir(directoryPath, { recursive: true });
        try {
            await fs.promises.writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
            await fs.promises.rename(temporaryPath, this.filePath);
        } catch (error) {
            await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
            throw error;
        }
        return normalizedEntries;
    }

    load() {
        return this.enqueue(() => this.loadUnsafe());
    }

    upsert(entries) {
        return this.enqueue(async () => {
            const currentEntries = await this.loadUnsafe();
            const byKey = new Map(currentEntries.map((entry) => [entry.key, entry]));
            entries.map(normalizeEntry).forEach((entry) => byKey.set(entry.key, entry));
            return this.saveUnsafe(Array.from(byKey.values()));
        });
    }
}

module.exports = {
    AVAILABILITY_STORE_VERSION,
    AVAILABILITY_FILE_NAME,
    CACHED_TTL_MS,
    UNCACHED_TTL_MS,
    UNAVAILABLE_TTL_MS,
    getDefaultAvailabilityPath,
    normalizeEntry,
    RealDebridAvailabilityStore
};
