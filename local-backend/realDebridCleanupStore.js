const fs = require('fs');
const path = require('path');
const { getDefaultDataDirectory } = require('./downloadRecordStore');

const CLEANUP_STORE_VERSION = 1;
const CLEANUP_FILE_NAME = 'realdebrid-pending-cleanup.json';

const getDefaultCleanupPath = () => path.join(getDefaultDataDirectory(), CLEANUP_FILE_NAME);

const normalizeRecord = (record) => {
    const id = record?.id === undefined || record?.id === null ? '' : String(record.id).trim();
    if (!id) {
        throw new Error('Real-Debrid cleanup record requires a torrent ID');
    }
    return {
        id,
        hash: typeof record.hash === 'string' ? record.hash.trim().toLowerCase() : null,
        createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
        attempts: Number.isSafeInteger(record.attempts) && record.attempts >= 0 ? record.attempts : 0,
        lastError: typeof record.lastError === 'string' ? record.lastError : null
    };
};

class RealDebridCleanupStore {
    constructor({ filePath = getDefaultCleanupPath() } = {}) {
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
            if (document?.version !== CLEANUP_STORE_VERSION || !Array.isArray(document.records)) {
                throw new Error(`Real-Debrid cleanup journal uses an unsupported format: ${this.filePath}`);
            }
            return document.records.map(normalizeRecord);
        } catch (error) {
            if (error?.code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }

    async saveUnsafe(records) {
        const normalizedRecords = records.map(normalizeRecord);
        const directoryPath = path.dirname(this.filePath);
        const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
        const document = {
            version: CLEANUP_STORE_VERSION,
            updatedAt: new Date().toISOString(),
            records: normalizedRecords
        };
        await fs.promises.mkdir(directoryPath, { recursive: true });
        try {
            await fs.promises.writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
            await fs.promises.rename(temporaryPath, this.filePath);
        } catch (error) {
            await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
            throw error;
        }
        return normalizedRecords;
    }

    load() {
        return this.enqueue(() => this.loadUnsafe());
    }

    add(record) {
        return this.enqueue(async () => {
            const records = await this.loadUnsafe();
            const normalizedRecord = normalizeRecord(record);
            await this.saveUnsafe([...records.filter((item) => item.id !== normalizedRecord.id), normalizedRecord]);
            return normalizedRecord;
        });
    }

    update(id, updates) {
        return this.enqueue(async () => {
            const records = await this.loadUnsafe();
            await this.saveUnsafe(records.map((record) => record.id === String(id) ? normalizeRecord({ ...record, ...updates }) : record));
        });
    }

    remove(id) {
        return this.enqueue(async () => {
            const records = await this.loadUnsafe();
            const nextRecords = records.filter((record) => record.id !== String(id));
            if (nextRecords.length !== records.length) {
                await this.saveUnsafe(nextRecords);
            }
        });
    }
}

module.exports = {
    CLEANUP_STORE_VERSION,
    CLEANUP_FILE_NAME,
    getDefaultCleanupPath,
    normalizeRecord,
    RealDebridCleanupStore
};
