const {
    CACHED_TTL_MS,
    UNCACHED_TTL_MS,
    UNAVAILABLE_TTL_MS
} = require('./realDebridAvailabilityStore');

const INFO_HASH_PATTERN = /^[a-f0-9]{40}$/i;
const VIDEO_FILE_PATTERN = /\.(mkv|mp4|avi|mov|m4v|ts|m2ts|webm|wmv)$/i;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_SOURCES_PER_CHECK = 50;
const DELETE_RETRY_COUNT = 3;
const FILE_METADATA_ATTEMPTS = 20;
const FILE_METADATA_POLL_MS = 250;
const AVAILABILITY_SETTLE_MS = 1000;
const AVAILABILITY_POLL_MS = 150;

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const normalizeFilename = (value) => typeof value === 'string' ? value.trim().replace(/\\/g, '/').toLowerCase() : '';
const getBasename = (value) => normalizeFilename(value).split('/').pop() || '';

const createSourceKey = ({ hash, fileIdx = null, filename = null, videoSize = null }) => [
    hash,
    fileIdx === null ? '' : String(fileIdx),
    encodeURIComponent(normalizeFilename(filename)),
    videoSize === null ? '' : String(videoSize)
].join('::');

const normalizeSource = (source) => {
    const hash = typeof source?.hash === 'string' ? source.hash.trim().toLowerCase() : '';
    if (!INFO_HASH_PATTERN.test(hash)) {
        const error = new Error('Real-Debrid source requires a valid 40-character info hash');
        error.code = 'REALDEBRID_INVALID_SOURCE';
        throw error;
    }
    const fileIdx = source.fileIdx === null || source.fileIdx === undefined ? null : source.fileIdx;
    if (fileIdx !== null && (!Number.isSafeInteger(fileIdx) || fileIdx < 0)) {
        const error = new Error('Real-Debrid source fileIdx must be a non-negative integer');
        error.code = 'REALDEBRID_INVALID_SOURCE';
        throw error;
    }
    const filename = typeof source.filename === 'string' && source.filename.trim() ? source.filename.trim().slice(0, 1000) : null;
    const videoSize = Number.isSafeInteger(source.videoSize) && source.videoSize > 0 ? source.videoSize : null;
    const normalized = { hash, fileIdx, filename, videoSize };
    return { ...normalized, key: createSourceKey(normalized) };
};

const normalizeSources = (sources) => {
    if (!Array.isArray(sources)) {
        const error = new Error('sources must be an array');
        error.code = 'REALDEBRID_INVALID_SOURCES';
        throw error;
    }
    if (sources.length > MAX_SOURCES_PER_CHECK) {
        const error = new Error(`No more than ${MAX_SOURCES_PER_CHECK} sources can be checked at once`);
        error.code = 'REALDEBRID_TOO_MANY_SOURCES';
        throw error;
    }
    const valid = [];
    const invalid = [];
    const seen = new Set();
    sources.forEach((source, index) => {
        try {
            const normalized = normalizeSource(source);
            if (!seen.has(normalized.key)) {
                seen.add(normalized.key);
                valid.push(normalized);
            }
        } catch (error) {
            invalid.push({ source, index, error: error.message });
        }
    });
    return { valid, invalid };
};

const normalizeFiles = (files) => Array.isArray(files) ? files
    .filter((file) => file?.id !== undefined && file?.id !== null && typeof file?.path === 'string')
    .map((file) => ({
        ...file,
        id: String(file.id),
        bytes: Number.isSafeInteger(Number(file.bytes)) ? Number(file.bytes) : null,
        normalizedPath: normalizeFilename(file.path),
        normalizedBasename: getBasename(file.path)
    })) : [];

const chooseUnique = (files, reason) => files.length === 1 ? { file: files[0], reason } : null;

const matchSourceFile = (source, files) => {
    const normalizedFiles = normalizeFiles(files);
    const videoFiles = normalizedFiles.filter((file) => VIDEO_FILE_PATTERN.test(file.path));
    const candidates = videoFiles.length > 0 ? videoFiles : normalizedFiles;
    if (candidates.length === 0) {
        return { file: null, reason: 'no_files' };
    }

    const filename = normalizeFilename(source.filename);
    if (filename) {
        const exactPath = candidates.filter((file) => file.normalizedPath === filename);
        const exactPathMatch = chooseUnique(exactPath, 'exact_path');
        if (exactPathMatch) {
            return exactPathMatch;
        }
        const basename = getBasename(filename);
        const exactBasename = candidates.filter((file) => file.normalizedBasename === basename);
        const exactBasenameMatch = chooseUnique(exactBasename, 'exact_filename');
        if (exactBasenameMatch) {
            return exactBasenameMatch;
        }
        if (source.videoSize) {
            const filenameAndSize = exactBasename.filter((file) => file.bytes === source.videoSize);
            const filenameAndSizeMatch = chooseUnique(filenameAndSize, 'filename_and_size');
            if (filenameAndSizeMatch) {
                return filenameAndSizeMatch;
            }
        }
    }

    if (source.videoSize) {
        const sizeMatches = candidates.filter((file) => file.bytes === source.videoSize);
        const sizeMatch = chooseUnique(sizeMatches, 'exact_size');
        if (sizeMatch) {
            return sizeMatch;
        }
    }

    if (source.fileIdx !== null) {
        const oneBasedMatch = chooseUnique(candidates.filter((file) => Number(file.id) === source.fileIdx + 1), 'file_index');
        if (oneBasedMatch) {
            return oneBasedMatch;
        }
        const directMatch = chooseUnique(candidates.filter((file) => Number(file.id) === source.fileIdx), 'direct_file_id');
        if (directMatch) {
            return directMatch;
        }
    }

    const singleVideo = chooseUnique(videoFiles, 'single_video');
    return singleVideo || { file: null, reason: candidates.length > 1 ? 'ambiguous_files' : 'unmatched_file' };
};

const getTorrentHash = (torrent) => typeof torrent?.hash === 'string' && INFO_HASH_PATTERN.test(torrent.hash.trim()) ?
    torrent.hash.trim().toLowerCase()
    : null;

class RealDebridAvailabilityService {
    constructor({
        client,
        cleanupStore,
        historyStore,
        cacheTtlMs = DEFAULT_CACHE_TTL_MS,
        now = () => Date.now(),
        sleep = wait,
        onWarning = () => undefined
    }) {
        this.client = client;
        this.cleanupStore = cleanupStore;
        this.historyStore = historyStore;
        this.cacheTtlMs = cacheTtlMs;
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

    check(accessToken, sources) {
        return this.enqueue(() => this.performCheck(accessToken, sources));
    }

    getHistory(sources) {
        return this.enqueue(() => this.performGetHistory(sources));
    }

    recordObservation(source, status, observationSource = 'download_observation') {
        return this.enqueue(() => this.performRecordObservation(source, status, observationSource));
    }

    retryPendingCleanup(accessToken) {
        return this.enqueue(() => this.performPendingCleanup(accessToken));
    }

    async getPendingCleanupCount() {
        return (await this.cleanupStore.load()).length;
    }

    clearCache() {
        this.cache.clear();
    }

    async performGetHistory(sources) {
        const { valid, invalid } = normalizeSources(sources);
        const entries = await this.historyStore.load();
        const byKey = new Map(entries.map((entry) => [entry.key, entry]));
        const now = this.now();
        const items = valid.map((source) => {
            const entry = byKey.get(source.key);
            if (!entry || Date.parse(entry.expiresAt) <= now) {
                return { ...source, status: 'unknown', verifiedAt: null, expiresAt: null, source: null, previouslyVerified: false };
            }
            return {
                ...entry,
                previouslyVerified: entry.status === 'cached'
            };
        });
        invalid.forEach((item) => items.push({
            key: null,
            hash: typeof item.source?.hash === 'string' ? item.source.hash : null,
            fileIdx: null,
            filename: null,
            videoSize: null,
            status: 'invalid',
            verifiedAt: null,
            expiresAt: null,
            source: null,
            previouslyVerified: false,
            error: item.error
        }));
        return { items };
    }

    async performRecordObservation(source, status, observationSource = 'explicit_check') {
        if (!['cached', 'uncached', 'unavailable'].includes(status)) {
            return null;
        }
        const verifiedAtMs = this.now();
        const ttlMs = status === 'cached' ? CACHED_TTL_MS : status === 'uncached' ? UNCACHED_TTL_MS : UNAVAILABLE_TTL_MS;
        const entry = {
            ...source,
            status,
            verifiedAt: new Date(verifiedAtMs).toISOString(),
            expiresAt: new Date(verifiedAtMs + ttlMs).toISOString(),
            source: observationSource
        };
        await this.historyStore.upsert([entry]);
        if (observationSource === 'failed_download') {
            this.cache.delete(source.key);
        } else {
            this.cache.set(source.key, {
                result: { status: entry.status, targetFile: null },
                expiresAt: this.now() + this.cacheTtlMs
            });
        }
        return entry;
    }

    async performCheck(accessToken, sources) {
        const { valid, invalid } = normalizeSources(sources);
        const results = invalid.map((item) => ({
            key: null,
            hash: typeof item.source?.hash === 'string' ? item.source.hash : null,
            status: 'invalid',
            error: item.error
        }));

        for (const source of valid) {
            const cached = this.cache.get(source.key);
            if (cached && cached.expiresAt > this.now()) {
                results.push({ ...source, ...cached.result, fromCache: true });
                continue;
            }
            let result;
            try {
                result = await this.checkSource(accessToken, source);
            } catch (error) {
                result = { status: 'error', error: error?.message || 'Real-Debrid availability check failed' };
            }
            const item = { ...source, ...result, checkedAt: new Date(this.now()).toISOString(), fromCache: false };
            results.push(item);
            if (['cached', 'uncached', 'unavailable'].includes(item.status)) {
                this.cache.set(source.key, {
                    result: { status: item.status, targetFile: item.targetFile ?? null },
                    expiresAt: this.now() + this.cacheTtlMs
                });
                await this.performRecordObservation(source, item.status, 'explicit_check');
            }
        }

        const pendingCleanup = await this.getPendingCleanupCount();
        return {
            items: results,
            pendingCleanup,
            cleanupWarning: pendingCleanup > 0 ? 'Some temporary Real-Debrid torrents still need cleanup. The backend will keep retrying.' : null
        };
    }

    async snapshotMatchingIds(accessToken, hash) {
        const torrents = await this.client.getTorrents(accessToken);
        return (Array.isArray(torrents) ? torrents : [])
            .filter((torrent) => getTorrentHash(torrent) === hash)
            .map((torrent) => String(torrent.id));
    }

    async reconcileNewTorrents(accessToken, hash, protectedIds) {
        const torrents = await this.client.getTorrents(accessToken);
        const protectedSet = new Set(protectedIds.map(String));
        const createdAt = new Date(this.now()).toISOString();
        const newIds = (Array.isArray(torrents) ? torrents : [])
            .filter((torrent) => getTorrentHash(torrent) === hash && torrent?.id !== undefined && torrent?.id !== null)
            .map((torrent) => String(torrent.id))
            .filter((id) => !protectedSet.has(id));
        for (const id of newIds) {
            await this.cleanupStore.add({ id, hash, createdAt });
        }
        await this.performPendingCleanup(accessToken);
    }

    async waitForFiles(accessToken, id) {
        let info = null;
        for (let attempt = 0; attempt < FILE_METADATA_ATTEMPTS; attempt += 1) {
            info = await this.client.getTorrentInfo(accessToken, id);
            if (Array.isArray(info?.files) && info.files.length > 0) {
                return info;
            }
            if (['magnet_error', 'error', 'virus', 'dead'].includes(info?.status)) {
                return info;
            }
            if (attempt < FILE_METADATA_ATTEMPTS - 1) {
                await this.sleep(FILE_METADATA_POLL_MS);
            }
        }
        return info;
    }

    async observeSelection(accessToken, id) {
        const startedAt = this.now();
        let info = null;
        do {
            info = await this.client.getTorrentInfo(accessToken, id);
            if (info?.status === 'downloaded' && Number(info.progress) === 100) {
                return { status: 'cached', info };
            }
            if (info?.status === 'downloading' && (Number(info.progress) > 0 || Number(info.speed) > 0)) {
                return { status: 'uncached', info };
            }
            if (this.now() - startedAt >= AVAILABILITY_SETTLE_MS) {
                return { status: 'uncached', info };
            }
            await this.sleep(AVAILABILITY_POLL_MS);
        } while (true);
    }

    async checkSource(accessToken, source) {
        const protectedIds = await this.snapshotMatchingIds(accessToken, source.hash);
        let torrentId = null;
        try {
            let added;
            try {
                added = await this.client.addMagnet(accessToken, source.hash);
            } catch (error) {
                if (error?.status === 451 || error?.providerCode === 35) {
                    return { status: 'unavailable', error: error.message };
                }
                await this.reconcileNewTorrents(accessToken, source.hash, protectedIds).catch((cleanupError) => {
                    this.onWarning(`Could not reconcile Real-Debrid hash ${source.hash}: ${cleanupError.message || 'unknown error'}`);
                });
                throw error;
            }
            torrentId = added?.id === undefined || added?.id === null ? null : String(added.id);
            if (!torrentId) {
                throw new Error('Real-Debrid did not return a torrent ID');
            }
            if (protectedIds.includes(torrentId)) {
                return { status: 'error', error: 'Real-Debrid returned a pre-existing torrent; it was not modified' };
            }
            await this.cleanupStore.add({ id: torrentId, hash: source.hash, createdAt: new Date(this.now()).toISOString() });

            const info = await this.waitForFiles(accessToken, torrentId);
            const match = matchSourceFile(source, info?.files);
            if (!match.file) {
                return { status: 'unknown', error: `Could not safely identify the requested file (${match.reason})` };
            }
            await this.client.selectFiles(accessToken, torrentId, [match.file.id]);
            const observation = await this.observeSelection(accessToken, torrentId);
            return {
                status: observation.status,
                targetFile: {
                    id: match.file.id,
                    path: match.file.path,
                    bytes: match.file.bytes,
                    matchReason: match.reason
                },
                providerStatus: observation.info?.status ?? null
            };
        } finally {
            if (torrentId) {
                await this.performPendingCleanup(accessToken);
            }
        }
    }

    async performPendingCleanup(accessToken) {
        const records = await this.cleanupStore.load();
        if (records.length === 0) {
            return { cleaned: 0, pending: 0 };
        }
        const deletionSucceeded = new Set();
        for (const record of records) {
            let lastError = null;
            for (let attempt = 1; attempt <= DELETE_RETRY_COUNT; attempt += 1) {
                try {
                    await this.client.deleteTorrent(accessToken, record.id);
                    deletionSucceeded.add(record.id);
                    lastError = null;
                    break;
                } catch (error) {
                    if (error?.status === 404 || error?.providerCode === 7) {
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
                this.onWarning(`Could not clean up temporary Real-Debrid torrent ${record.id}: ${lastError.message || 'unknown error'}`);
            }
        }

        if (deletionSucceeded.size > 0) {
            try {
                const torrents = await this.client.getTorrents(accessToken);
                const remainingIds = new Set((Array.isArray(torrents) ? torrents : []).map((torrent) => String(torrent.id)));
                for (const id of deletionSucceeded) {
                    if (!remainingIds.has(id)) {
                        await this.cleanupStore.remove(id);
                    }
                }
            } catch (error) {
                this.onWarning(`Could not verify Real-Debrid cleanup: ${error.message || 'unknown error'}`);
            }
        }
        const pending = await this.getPendingCleanupCount();
        return { cleaned: records.length - pending, pending };
    }
}

module.exports = {
    INFO_HASH_PATTERN,
    VIDEO_FILE_PATTERN,
    DEFAULT_CACHE_TTL_MS,
    MAX_SOURCES_PER_CHECK,
    normalizeSource,
    normalizeSources,
    createSourceKey,
    matchSourceFile,
    RealDebridAvailabilityService
};
