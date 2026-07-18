const fs = require('fs');
const path = require('path');
const { getDefaultDataDirectory } = require('./downloadRecordStore');

const CLEANUP_STORE_VERSION = 1;
const CLEANUP_FILE_NAME = 'alldebrid-pending-cleanup.json';

const getDefaultCleanupPath = () => path.join(getDefaultDataDirectory(), CLEANUP_FILE_NAME);

const normalizeRecord = (record) => {
    const id = record?.id === undefined || record?.id === null ? '' : String(record.id).trim();
    if (!id) {
        throw new Error('AllDebrid cleanup record requires a magnet ID');
    }

    return {
        id,
        hash: typeof record.hash === 'string' ? record.hash.toLowerCase() : null,
        createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
        attempts: Number.isSafeInteger(record.attempts) && record.attempts >= 0 ? record.attempts : 0,
        lastError: typeof record.lastError === 'string' ? record.lastError : null
    };
};

class AllDebridCleanupStore {
    constructor({ filePath = getDefaultCleanupPath() } = {}) {
        this.filePath = path.resolve(filePath);
    }

    async load() {
        try {
            const document = JSON.parse(await fs.promises.readFile(this.filePath, 'utf8'));
            if (document?.version !== CLEANUP_STORE_VERSION || !Array.isArray(document.records)) {
                throw new Error(`AllDebrid cleanup journal uses an unsupported format: ${this.filePath}`);
            }
            return document.records.map(normalizeRecord);
        } catch (error) {
            if (error?.code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }

    async save(records) {
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

    async add(record) {
        const records = await this.load();
        const normalizedRecord = normalizeRecord(record);
        const nextRecords = records.filter((item) => item.id !== normalizedRecord.id);
        nextRecords.push(normalizedRecord);
        await this.save(nextRecords);
        return normalizedRecord;
    }

    async update(id, updates) {
        const records = await this.load();
        const nextRecords = records.map((record) => record.id === String(id) ? normalizeRecord({ ...record, ...updates }) : record);
        await this.save(nextRecords);
    }

    async remove(id) {
        const records = await this.load();
        const nextRecords = records.filter((record) => record.id !== String(id));
        if (nextRecords.length !== records.length) {
            await this.save(nextRecords);
        }
    }
}

module.exports = {
    CLEANUP_STORE_VERSION,
    CLEANUP_FILE_NAME,
    getDefaultCleanupPath,
    AllDebridCleanupStore
};
