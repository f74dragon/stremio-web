const MAX_CONCURRENT_DOWNLOADS_ENV = 'CUSTOM_STREMIO_MAX_CONCURRENT_DOWNLOADS';
const DEFAULT_MAX_CONCURRENT_DOWNLOADS = 2;
const UNLIMITED_CONCURRENT_DOWNLOADS = 'unlimited';

const isValidMaxConcurrentDownloads = (value) => {
    return value === UNLIMITED_CONCURRENT_DOWNLOADS || (Number.isSafeInteger(value) && value >= 1);
};

const parseMaxConcurrentDownloads = (
    value,
    fallback = DEFAULT_MAX_CONCURRENT_DOWNLOADS
) => {
    if (typeof value === 'string' && value.trim().toLowerCase() === UNLIMITED_CONCURRENT_DOWNLOADS) {
        return UNLIMITED_CONCURRENT_DOWNLOADS;
    }

    const parsedValue = Number(value);
    return isValidMaxConcurrentDownloads(parsedValue) ?
        parsedValue
        :
        fallback;
};

const getConfiguredMaxConcurrentDownloads = () => {
    return parseMaxConcurrentDownloads(process.env[MAX_CONCURRENT_DOWNLOADS_ENV]);
};

const getQueueTimestamp = (record) => {
    for (const value of [record?.queuedAt, record?.createdAt, record?.lastAttemptAt]) {
        const timestamp = Date.parse(value || '');
        if (Number.isFinite(timestamp)) {
            return timestamp;
        }
    }
    return Number.MAX_SAFE_INTEGER;
};

const getPersistedQueueOrder = (record) => {
    const queueOrder = Number(record?.queueOrder);
    return Number.isSafeInteger(queueOrder) && queueOrder >= 1 ? queueOrder : null;
};

const sortQueuedDownloadRecords = (records) => {
    return records
        .map((record, index) => ({ record, index }))
        .sort((left, right) => {
            const leftOrder = getPersistedQueueOrder(left.record);
            const rightOrder = getPersistedQueueOrder(right.record);
            if (leftOrder !== null || rightOrder !== null) {
                if (leftOrder === null) return 1;
                if (rightOrder === null) return -1;
                if (leftOrder !== rightOrder) return leftOrder - rightOrder;
            }

            return getQueueTimestamp(left.record) - getQueueTimestamp(right.record) || left.index - right.index;
        })
        .map(({ record }) => record);
};

class DownloadScheduler {
    constructor({ maxConcurrentDownloads = DEFAULT_MAX_CONCURRENT_DOWNLOADS, onTaskError = () => {} } = {}) {
        this.maxConcurrentDownloads = parseMaxConcurrentDownloads(maxConcurrentDownloads);
        this.onTaskError = onTaskError;
        this.queue = [];
        this.active = new Map();
        this.stopped = false;
    }

    enqueue(id, run) {
        if (typeof id !== 'string' || id.length === 0 || typeof run !== 'function') {
            throw new TypeError('Scheduled downloads require a non-empty id and task function');
        }
        if (this.stopped) {
            return false;
        }
        if (this.active.has(id) || this.queue.some((entry) => entry.id === id)) {
            return false;
        }

        this.queue.push({ id, run });
        this.pump();
        return true;
    }

    remove(id) {
        const queueIndex = this.queue.findIndex((entry) => entry.id === id);
        if (queueIndex === -1) {
            return false;
        }

        this.queue.splice(queueIndex, 1);
        return true;
    }

    move(id, targetPosition) {
        if (!Number.isSafeInteger(targetPosition) || targetPosition < 1 || targetPosition > this.queue.length) {
            throw new RangeError(`Queue position must be an integer from 1 through ${this.queue.length}`);
        }

        const currentIndex = this.queue.findIndex((entry) => entry.id === id);
        if (currentIndex === -1) {
            return false;
        }

        const targetIndex = targetPosition - 1;
        if (currentIndex !== targetIndex) {
            const [entry] = this.queue.splice(currentIndex, 1);
            this.queue.splice(targetIndex, 0, entry);
        }

        return this.getSnapshot();
    }

    setQueueOrder(orderedIds) {
        if (!Array.isArray(orderedIds) || orderedIds.length !== this.queue.length || new Set(orderedIds).size !== orderedIds.length) {
            throw new TypeError('Queue order must contain every waiting download id exactly once');
        }

        const entriesById = new Map(this.queue.map((entry) => [entry.id, entry]));
        if (orderedIds.some((id) => !entriesById.has(id))) {
            throw new TypeError('Queue order contains an unknown waiting download id');
        }

        this.queue = orderedIds.map((id) => entriesById.get(id));
        return this.getSnapshot();
    }

    isQueued(id) {
        return this.queue.some((entry) => entry.id === id);
    }

    isActive(id) {
        return this.active.has(id);
    }

    stop() {
        this.stopped = true;
    }

    setMaxConcurrentDownloads(value) {
        if (!isValidMaxConcurrentDownloads(value)) {
            throw new RangeError('Maximum concurrent downloads must be a positive safe integer or unlimited');
        }

        this.maxConcurrentDownloads = value;
        this.pump();
        return this.getSnapshot();
    }

    getSnapshot() {
        return {
            maxConcurrentDownloads: this.maxConcurrentDownloads,
            activeCount: this.active.size,
            queuedCount: this.queue.length,
            activeIds: Array.from(this.active.keys()),
            queuedIds: this.queue.map((entry) => entry.id)
        };
    }

    pump() {
        const hasCapacity = () => {
            return this.maxConcurrentDownloads === UNLIMITED_CONCURRENT_DOWNLOADS || this.active.size < this.maxConcurrentDownloads;
        };

        while (!this.stopped && hasCapacity() && this.queue.length > 0) {
            const entry = this.queue.shift();
            this.active.set(entry.id, entry);
            this.runEntry(entry);
        }
    }

    async runEntry(entry) {
        try {
            await entry.run();
        } catch (error) {
            try {
                this.onTaskError(error, entry.id);
            } catch {
                // Scheduler cleanup must continue even if diagnostic reporting fails.
            }
        } finally {
            this.active.delete(entry.id);
            this.pump();
        }
    }
}

module.exports = {
    MAX_CONCURRENT_DOWNLOADS_ENV,
    DEFAULT_MAX_CONCURRENT_DOWNLOADS,
    UNLIMITED_CONCURRENT_DOWNLOADS,
    isValidMaxConcurrentDownloads,
    parseMaxConcurrentDownloads,
    getConfiguredMaxConcurrentDownloads,
    getPersistedQueueOrder,
    sortQueuedDownloadRecords,
    DownloadScheduler
};
