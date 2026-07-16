const fs = require('fs');
const os = require('os');
const path = require('path');

const STORE_VERSION = 1;
const DATA_DIR_ENV = 'CUSTOM_STREMIO_DATA_DIR';
const RECORDS_FILE_NAME = 'download-records.json';
const INTERRUPTED_STATUSES = new Set(['downloading']);
const INTERRUPTED_ERROR = 'Download paused because the local backend stopped before completion. Resume to continue.';

const getDefaultDataDirectory = () => {
    if (process.env[DATA_DIR_ENV]) {
        return path.resolve(process.env[DATA_DIR_ENV]);
    }

    if (process.env.LOCALAPPDATA) {
        return path.join(process.env.LOCALAPPDATA, 'Custom Stremio');
    }

    return path.join(os.homedir(), '.custom-stremio');
};

const getDefaultRecordsPath = () => path.join(getDefaultDataDirectory(), RECORDS_FILE_NAME);

const normalizeRecords = (records) => {
    if (!Array.isArray(records)) {
        return [];
    }

    const recordsById = new Map();
    records.forEach((record) => {
        if (!record || typeof record !== 'object' || Array.isArray(record)) {
            return;
        }

        const recordId = typeof record.id === 'string' ? record.id.trim() : '';
        if (!recordId || record.status === 'deleted') {
            return;
        }

        recordsById.set(recordId, {
            ...record,
            id: recordId
        });
    });

    return Array.from(recordsById.values());
};

const snapshotRecords = (records) => JSON.parse(JSON.stringify(normalizeRecords(records)));

const parseStoreDocument = (contents, filePath) => {
    let document;
    try {
        document = JSON.parse(contents);
    } catch (error) {
        const parseError = new Error(`Download record store is not valid JSON: ${filePath}`);
        parseError.code = 'DOWNLOAD_RECORD_STORE_INVALID';
        parseError.cause = error;
        throw parseError;
    }

    if (!document || typeof document !== 'object' || document.version !== STORE_VERSION || !Array.isArray(document.records)) {
        const formatError = new Error(`Download record store has an unsupported format: ${filePath}`);
        formatError.code = 'DOWNLOAD_RECORD_STORE_UNSUPPORTED';
        throw formatError;
    }

    return normalizeRecords(document.records);
};

const readDownloadRecords = async (filePath = getDefaultRecordsPath()) => {
    try {
        const contents = await fs.promises.readFile(filePath, 'utf8');
        return parseStoreDocument(contents, filePath);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return [];
        }

        throw error;
    }
};

const writeDownloadRecords = async (filePath, records) => {
    const directoryPath = path.dirname(filePath);
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const document = {
        version: STORE_VERSION,
        updatedAt: new Date().toISOString(),
        records: normalizeRecords(records)
    };

    await fs.promises.mkdir(directoryPath, { recursive: true });

    try {
        await fs.promises.writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
        await fs.promises.rename(temporaryPath, filePath);
    } catch (error) {
        try {
            await fs.promises.rm(temporaryPath, { force: true });
        } catch {
            // Preserve the original write/rename error if best-effort cleanup also fails.
        }
        throw error;
    }
};

const recoverInterruptedDownloadRecords = (records, now = new Date().toISOString()) => {
    let recoveredCount = 0;
    const recoveredRecords = normalizeRecords(records).map((record) => {
        if (!INTERRUPTED_STATUSES.has(record.status)) {
            return record;
        }

        recoveredCount += 1;
        return {
            ...record,
            status: 'paused',
            speedBytesPerSecond: 0,
            etaSeconds: null,
            completedAt: null,
            updatedAt: now,
            error: INTERRUPTED_ERROR
        };
    });

    return {
        records: recoveredRecords,
        recoveredCount
    };
};

class DownloadRecordStore {
    constructor({ filePath = getDefaultRecordsPath(), debounceMs = 250, onError = console.error } = {}) {
        this.filePath = path.resolve(filePath);
        this.debounceMs = debounceMs;
        this.onError = onError;
        this.pendingRecords = null;
        this.timer = null;
        this.writePromise = null;
    }

    load() {
        return readDownloadRecords(this.filePath);
    }

    schedule(records) {
        this.pendingRecords = snapshotRecords(records);

        if (this.timer !== null) {
            clearTimeout(this.timer);
        }

        this.timer = setTimeout(() => {
            this.timer = null;
            this.flush().catch(this.onError);
        }, this.debounceMs);
    }

    async flush(records) {
        if (records !== undefined) {
            this.pendingRecords = snapshotRecords(records);
        }

        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        if (this.writePromise !== null) {
            await this.writePromise;
            if (this.pendingRecords !== null) {
                await this.flush();
            }
            return;
        }

        if (this.pendingRecords === null) {
            return;
        }

        this.writePromise = (async () => {
            while (this.pendingRecords !== null) {
                const nextRecords = this.pendingRecords;
                this.pendingRecords = null;
                await writeDownloadRecords(this.filePath, nextRecords);
            }
        })();

        try {
            await this.writePromise;
        } finally {
            this.writePromise = null;
        }
    }
}

module.exports = {
    STORE_VERSION,
    DATA_DIR_ENV,
    RECORDS_FILE_NAME,
    INTERRUPTED_ERROR,
    getDefaultDataDirectory,
    getDefaultRecordsPath,
    normalizeRecords,
    readDownloadRecords,
    writeDownloadRecords,
    recoverInterruptedDownloadRecords,
    DownloadRecordStore
};
