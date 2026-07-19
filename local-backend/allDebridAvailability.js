const INFO_HASH_PATTERN = /^[a-f0-9]{40}$/i;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 5;
const MAX_HASHES_PER_CHECK = 100;
const DELETE_RETRY_COUNT = 3;
const {
    CACHED_TTL_MS,
    UNCACHED_TTL_MS,
    UNAVAILABLE_TTL_MS
} = require('./allDebridAvailabilityStore');

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const normalizeInfoHashes = (hashes) => {
    if (!Array.isArray(hashes)) {
        const error = new Error('hashes must be an array');
        error.code = 'ALLDEBRID_INVALID_HASHES';
        throw error;
    }

    const seen = new Set();
    const valid = [];
    const invalid = [];
    hashes.forEach((value) => {
        const hash = typeof value === 'string' ? value.trim().toLowerCase() : '';
        if (!INFO_HASH_PATTERN.test(hash)) {
            invalid.push(value);
        } else if (!seen.has(hash)) {
            seen.add(hash);
            valid.push(hash);
        }
    });

    if (valid.length > MAX_HASHES_PER_CHECK) {
        const error = new Error(`No more than ${MAX_HASHES_PER_CHECK} unique hashes can be checked at once`);
        error.code = 'ALLDEBRID_TOO_MANY_HASHES';
        throw error;
    }

    return { valid, invalid };
};

const getMagnetItems = (data) => Array.isArray(data?.magnets) ? data.magnets : [];
const getMagnetHash = (magnet) => typeof magnet?.hash === 'string' && INFO_HASH_PATTERN.test(magnet.hash.trim()) ? magnet.hash.trim().toLowerCase() : null;

class AllDebridAvailabilityService {
    constructor({
        client,
        cleanupStore,
        historyStore,
        cacheTtlMs = DEFAULT_CACHE_TTL_MS,
        batchSize = DEFAULT_BATCH_SIZE,
        now = () => Date.now(),
        sleep = wait,
        onWarning = () => undefined
    }) {
        this.client = client;
        this.cleanupStore = cleanupStore;
        this.historyStore = historyStore;
        this.cacheTtlMs = cacheTtlMs;
        this.batchSize = batchSize;
        this.now = now;
        this.sleep = sleep;
        this.onWarning = onWarning;
        this.cache = new Map();
        this.operationQueue = Promise.resolve();
    }

    enqueue(operation) {
        const result = this.operationQueue.then(operation);
        this.operationQueue = result.catch(() => undefined);
        return result;
    }

    check(apiKey, hashes) {
        return this.enqueue(() => this.performCheck(apiKey, hashes));
    }

    retryPendingCleanup(apiKey) {
        return this.enqueue(() => this.performPendingCleanup(apiKey));
    }

    getHistory(hashes) {
        return this.enqueue(() => this.performGetHistory(hashes));
    }

    recordObservation(hash, status, source) {
        return this.enqueue(() => this.performRecordObservations([{ hash, status, source }]));
    }

    snapshotMatchingMagnetIds(apiKey, hash) {
        return this.enqueue(() => this.performSnapshotMatchingMagnetIds(apiKey, hash));
    }

    cleanupNewMagnetsForHash(apiKey, hash, preexistingIds = []) {
        return this.enqueue(() => this.performCleanupNewMagnetsForHash(apiKey, hash, preexistingIds));
    }

    async getPendingCleanupCount() {
        return (await this.cleanupStore.load()).length;
    }

    clearCache() {
        this.cache.clear();
    }

    async performGetHistory(hashes) {
        const { valid, invalid } = normalizeInfoHashes(hashes);
        const entries = await this.historyStore.load();
        const byHash = new Map(entries.map((entry) => [entry.hash, entry]));
        const now = this.now();
        const items = valid.map((hash) => {
            const entry = byHash.get(hash);
            if (!entry || Date.parse(entry.expiresAt) <= now) {
                return { hash, status: 'unknown', verifiedAt: null, expiresAt: null, source: null, previouslyVerified: false };
            }
            return {
                ...entry,
                previouslyVerified: entry.status === 'cached'
            };
        });
        invalid.forEach((value) => items.push({
            hash: typeof value === 'string' ? value : null,
            status: 'invalid',
            verifiedAt: null,
            expiresAt: null,
            source: null,
            previouslyVerified: false
        }));
        return { items };
    }

    async performRecordObservations(observations) {
        const verifiedAtMs = this.now();
        const entries = observations.map((observation) => {
            const { valid } = normalizeInfoHashes([observation?.hash]);
            const status = observation?.status;
            if (valid.length !== 1 || !['cached', 'uncached', 'unavailable'].includes(status)) {
                const error = new Error('Availability observations require a valid hash and cached, uncached, or unavailable status');
                error.code = 'ALLDEBRID_INVALID_OBSERVATION';
                throw error;
            }
            const ttlMs = status === 'cached' ? CACHED_TTL_MS : status === 'uncached' ? UNCACHED_TTL_MS : UNAVAILABLE_TTL_MS;
            return {
                hash: valid[0],
                status,
                verifiedAt: new Date(verifiedAtMs).toISOString(),
                expiresAt: new Date(verifiedAtMs + ttlMs).toISOString(),
                source: observation?.source || 'unknown'
            };
        });
        if (entries.length > 0) {
            await this.historyStore.upsert(entries);
            entries.forEach((entry) => {
                if (entry.source === 'failed_download') {
                    this.cache.delete(entry.hash);
                } else {
                    this.cache.set(entry.hash, {
                        status: entry.status,
                        checkedAt: entry.verifiedAt,
                        expiresAt: this.now() + this.cacheTtlMs
                    });
                }
            });
        }
        return entries;
    }

    async performSnapshotMatchingMagnetIds(apiKey, hash) {
        const { valid } = normalizeInfoHashes([hash]);
        const snapshot = await this.client.getMagnets(apiKey);
        return getMagnetItems(snapshot)
            .filter((magnet) => getMagnetHash(magnet) === valid[0])
            .map((magnet) => String(magnet.id));
    }

    async performCleanupNewMagnetsForHash(apiKey, hash, preexistingIds = []) {
        const { valid } = normalizeInfoHashes([hash]);
        const normalizedHash = valid[0];
        const protectedIds = new Set((Array.isArray(preexistingIds) ? preexistingIds : []).map(String));
        const snapshot = await this.client.getMagnets(apiKey);
        const createdAt = new Date(this.now()).toISOString();
        const newIds = getMagnetItems(snapshot)
            .filter((magnet) => getMagnetHash(magnet) === normalizedHash && magnet?.id !== undefined && magnet?.id !== null)
            .map((magnet) => String(magnet.id))
            .filter((id) => !protectedIds.has(id));

        for (const id of newIds) {
            await this.cleanupStore.add({ id, hash: normalizedHash, createdAt });
        }
        const cleanup = await this.performPendingCleanup(apiKey);
        return { ...cleanup, discovered: newIds.length };
    }

    async performCheck(apiKey, hashes) {
        const { valid, invalid } = normalizeInfoHashes(hashes);
        const checkedAt = new Date(this.now()).toISOString();
        const results = invalid.map((value) => ({
            hash: typeof value === 'string' ? value : null,
            status: 'invalid',
            checkedAt
        }));
        const unknownHashes = [];

        valid.forEach((hash) => {
            const cached = this.cache.get(hash);
            if (cached && cached.expiresAt > this.now()) {
                results.push({ hash, status: cached.status, checkedAt: cached.checkedAt, fromCache: true });
            } else {
                unknownHashes.push(hash);
            }
        });

        if (unknownHashes.length > 0) {
            const snapshot = await this.client.getMagnets(apiKey);
            const preexistingIds = new Set(getMagnetItems(snapshot).map((magnet) => String(magnet.id)));

            for (let index = 0; index < unknownHashes.length; index += this.batchSize) {
                const batch = unknownHashes.slice(index, index + this.batchSize);
                let uploadData;
                try {
                    uploadData = await this.client.uploadHashes(apiKey, batch);
                } catch (error) {
                    for (const hash of batch) {
                        try {
                            await this.performCleanupNewMagnetsForHash(apiKey, hash, Array.from(preexistingIds));
                        } catch (cleanupError) {
                            this.onWarning(`Could not reconcile AllDebrid hash ${hash} after an upload error: ${cleanupError.message || 'unknown error'}`);
                        }
                    }
                    throw error;
                }
                const uploadItems = getMagnetItems(uploadData);
                const resultByHash = new Map();

                for (const item of uploadItems) {
                    const itemHash = typeof item?.hash === 'string' ? item.hash.toLowerCase() : null;
                    if (itemHash) {
                        resultByHash.set(itemHash, item);
                    }
                    if (item?.id !== undefined && item?.id !== null && !preexistingIds.has(String(item.id))) {
                        await this.cleanupStore.add({ id: item.id, hash: itemHash, createdAt: checkedAt });
                    }
                }

                batch.forEach((hash) => {
                    const item = resultByHash.get(hash);
                    const status = item?.ready === true ? 'cached' : !item || item?.error ? 'error' : 'uncached';
                    const result = {
                        hash,
                        status,
                        checkedAt,
                        fromCache: false
                    };
                    if (!item) {
                        result.error = 'AllDebrid did not return a result for this hash';
                    } else if (item?.error?.message) {
                        result.error = item.error.message;
                    }
                    results.push(result);
                    if (status === 'cached' || status === 'uncached') {
                        this.cache.set(hash, {
                            status,
                            checkedAt,
                            expiresAt: this.now() + this.cacheTtlMs
                        });
                    }
                });

                await this.performRecordObservations(results.filter((result) =>
                    batch.includes(result.hash) && ['cached', 'uncached'].includes(result.status)
                ).map((result) => ({
                    hash: result.hash,
                    status: result.status,
                    source: 'explicit_check'
                })));

                await this.performPendingCleanup(apiKey);
            }
        }

        const pendingCleanup = await this.getPendingCleanupCount();
        return {
            items: results.sort((left, right) => valid.indexOf(left.hash) - valid.indexOf(right.hash)),
            pendingCleanup,
            cleanupWarning: pendingCleanup > 0 ? 'Some temporary AllDebrid magnets still need cleanup. The backend will keep retrying.' : null
        };
    }

    async performPendingCleanup(apiKey) {
        const records = await this.cleanupStore.load();
        if (records.length === 0) {
            return { cleaned: 0, pending: 0 };
        }

        const deletionSucceeded = new Set();
        for (const record of records) {
            let lastError = null;
            for (let attempt = 1; attempt <= DELETE_RETRY_COUNT; attempt += 1) {
                try {
                    await this.client.deleteMagnet(apiKey, record.id);
                    deletionSucceeded.add(record.id);
                    lastError = null;
                    break;
                } catch (error) {
                    if (error?.code === 'MAGNET_INVALID_ID') {
                        deletionSucceeded.add(record.id);
                        lastError = null;
                        break;
                    }
                    lastError = error;
                    if (attempt < DELETE_RETRY_COUNT) {
                        await this.sleep(150 * attempt);
                    }
                }
            }

            if (lastError) {
                await this.cleanupStore.update(record.id, {
                    attempts: record.attempts + DELETE_RETRY_COUNT,
                    lastError: lastError.message || 'Cleanup failed'
                });
                this.onWarning(`Could not clean up temporary AllDebrid magnet ${record.id}: ${lastError.message || 'unknown error'}`);
            }
        }

        if (deletionSucceeded.size > 0) {
            try {
                const snapshot = await this.client.getMagnets(apiKey);
                const remainingIds = new Set(getMagnetItems(snapshot).map((magnet) => String(magnet.id)));
                for (const id of deletionSucceeded) {
                    if (!remainingIds.has(id)) {
                        await this.cleanupStore.remove(id);
                    }
                }
            } catch (error) {
                this.onWarning(`Could not verify AllDebrid cleanup: ${error.message || 'unknown error'}`);
            }
        }

        const pending = await this.getPendingCleanupCount();
        return { cleaned: records.length - pending, pending };
    }
}

module.exports = {
    INFO_HASH_PATTERN,
    DEFAULT_CACHE_TTL_MS,
    DEFAULT_BATCH_SIZE,
    MAX_HASHES_PER_CHECK,
    normalizeInfoHashes,
    AllDebridAvailabilityService
};
