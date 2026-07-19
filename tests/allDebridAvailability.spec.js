/* global jest, describe, beforeEach, afterEach, test, expect */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { AllDebridCleanupStore } = require('../local-backend/allDebridCleanupStore');
const { AllDebridAvailabilityStore } = require('../local-backend/allDebridAvailabilityStore');
const { normalizeInfoHashes, AllDebridAvailabilityService } = require('../local-backend/allDebridAvailability');

const HASH_CACHED = '842783e3005495d5d1637f5364b59343c7844707';
const HASH_UNCACHED = '194257a7bf4eaea978f4b5b7fbd3b4efcdd99e43';
const HASH_PREEXISTING = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('AllDebridAvailabilityService', () => {
    let tempDirectory;
    let cleanupStore;
    let historyStore;

    beforeEach(() => {
        tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-stremio-ad-'));
        cleanupStore = new AllDebridCleanupStore({ filePath: path.join(tempDirectory, 'cleanup.json') });
        historyStore = new AllDebridAvailabilityStore({ filePath: path.join(tempDirectory, 'history.json') });
    });

    afterEach(() => {
        fs.rmSync(tempDirectory, { recursive: true, force: true });
    });

    test('deduplicates valid hashes and reports invalid values', () => {
        expect(normalizeInfoHashes([HASH_CACHED.toUpperCase(), HASH_CACHED, 'bad'])).toEqual({
            valid: [HASH_CACHED],
            invalid: ['bad']
        });
    });

    test('detects ready and uncached hashes, protects existing magnets, and verifies cleanup', async () => {
        const client = {
            getMagnets: jest.fn()
                .mockResolvedValueOnce({ magnets: [{ id: 77, hash: HASH_PREEXISTING }] })
                .mockResolvedValueOnce({ magnets: [{ id: 77, hash: HASH_PREEXISTING }] }),
            uploadHashes: jest.fn().mockResolvedValue({
                magnets: [
                    { id: 100, hash: HASH_CACHED, ready: true },
                    { id: 101, hash: HASH_UNCACHED, ready: false },
                    { id: 77, hash: HASH_PREEXISTING, ready: true }
                ]
            }),
            deleteMagnet: jest.fn().mockResolvedValue({ message: 'deleted' })
        };
        const service = new AllDebridAvailabilityService({ client, cleanupStore, historyStore, sleep: jest.fn() });

        const result = await service.check('key', [HASH_CACHED, HASH_UNCACHED, HASH_PREEXISTING]);
        expect(result.items.map(({ hash, status }) => ({ hash, status }))).toEqual([
            { hash: HASH_CACHED, status: 'cached' },
            { hash: HASH_UNCACHED, status: 'uncached' },
            { hash: HASH_PREEXISTING, status: 'cached' }
        ]);
        expect(result.items.every((item) => item.fromCache === false)).toBe(true);
        expect(client.deleteMagnet.mock.calls.map((call) => call[1])).toEqual(['100', '101']);
        expect(await cleanupStore.load()).toEqual([]);

        const cachedResult = await service.check('key', [HASH_CACHED, HASH_UNCACHED, HASH_PREEXISTING]);
        expect(cachedResult.items.every((item) => item.fromCache === true)).toBe(true);
        expect(client.uploadHashes).toHaveBeenCalledTimes(1);
        await expect(service.getHistory([HASH_CACHED, HASH_UNCACHED])).resolves.toMatchObject({
            items: [
                { hash: HASH_CACHED, status: 'cached', source: 'explicit_check' },
                { hash: HASH_UNCACHED, status: 'uncached', source: 'explicit_check' }
            ]
        });
    });

    test('persists failed cleanup and recovers it after a simulated restart', async () => {
        const warning = jest.fn();
        const client = {
            getMagnets: jest.fn().mockResolvedValue({ magnets: [] }),
            uploadHashes: jest.fn().mockResolvedValue({ magnets: [{ id: 200, hash: HASH_UNCACHED, ready: false }] }),
            deleteMagnet: jest.fn().mockRejectedValue(new Error('provider offline'))
        };
        const service = new AllDebridAvailabilityService({ client, cleanupStore, historyStore, sleep: jest.fn(), onWarning: warning });
        const result = await service.check('key', [HASH_UNCACHED]);
        expect(result.pendingCleanup).toBe(1);
        expect(warning).toHaveBeenCalled();
        expect((await cleanupStore.load())[0]).toMatchObject({ id: '200', hash: HASH_UNCACHED });

        const recoveredClient = {
            deleteMagnet: jest.fn().mockRejectedValue(Object.assign(new Error('already gone'), { code: 'MAGNET_INVALID_ID' })),
            getMagnets: jest.fn().mockResolvedValue({ magnets: [] })
        };
        const recoveredService = new AllDebridAvailabilityService({ client: recoveredClient, cleanupStore, historyStore, sleep: jest.fn() });
        await expect(recoveredService.retryPendingCleanup('key')).resolves.toEqual({ cleaned: 1, pending: 0 });
        expect(await cleanupStore.load()).toEqual([]);
    });

    test('deletes only newly created magnets with the exact requested hash', async () => {
        const client = {
            getMagnets: jest.fn()
                .mockResolvedValueOnce({ magnets: [{ id: 10, hash: HASH_UNCACHED }] })
                .mockResolvedValueOnce({ magnets: [
                    { id: 10, hash: HASH_UNCACHED },
                    { id: 11, hash: HASH_UNCACHED },
                    { id: 12, hash: HASH_CACHED }
                ] })
                .mockResolvedValueOnce({ magnets: [
                    { id: 10, hash: HASH_UNCACHED },
                    { id: 12, hash: HASH_CACHED }
                ] }),
            deleteMagnet: jest.fn().mockResolvedValue({ message: 'deleted' })
        };
        const service = new AllDebridAvailabilityService({ client, cleanupStore, historyStore, sleep: jest.fn() });
        const preexistingIds = await service.snapshotMatchingMagnetIds('key', HASH_UNCACHED);
        const cleanup = await service.cleanupNewMagnetsForHash('key', HASH_UNCACHED, preexistingIds);

        expect(preexistingIds).toEqual(['10']);
        expect(client.deleteMagnet).toHaveBeenCalledWith('key', '11');
        expect(client.deleteMagnet).not.toHaveBeenCalledWith('key', '10');
        expect(client.deleteMagnet).not.toHaveBeenCalledWith('key', '12');
        expect(cleanup).toEqual({ cleaned: 1, pending: 0, discovered: 1 });
    });

    test('keeps positive history long term but replaces it when a later download proves the source unavailable', async () => {
        let now = Date.parse('2026-07-18T12:00:00.000Z');
        const service = new AllDebridAvailabilityService({
            client: {},
            cleanupStore,
            historyStore,
            now: () => now
        });
        await service.recordObservation(HASH_CACHED, 'cached', 'completed_download');
        await service.recordObservation(HASH_UNCACHED, 'uncached', 'placeholder_response');

        now += 2 * 24 * 60 * 60 * 1000;
        await expect(service.getHistory([HASH_CACHED, HASH_UNCACHED])).resolves.toMatchObject({
            items: [
                { hash: HASH_CACHED, status: 'cached', source: 'completed_download', previouslyVerified: true },
                { hash: HASH_UNCACHED, status: 'unknown', previouslyVerified: false }
            ]
        });

        await service.recordObservation(HASH_CACHED, 'unavailable', 'failed_download');
        await expect(service.getHistory([HASH_CACHED])).resolves.toMatchObject({
            items: [{ hash: HASH_CACHED, status: 'unavailable', source: 'failed_download', previouslyVerified: false }]
        });

        now += 29 * 24 * 60 * 60 * 1000;
        await expect(service.getHistory([HASH_CACHED])).resolves.toMatchObject({
            items: [{ hash: HASH_CACHED, status: 'unknown', previouslyVerified: false }]
        });
    });

    test('reconciles and deletes an exact-hash magnet when the upload response is lost', async () => {
        const client = {
            getMagnets: jest.fn()
                .mockResolvedValueOnce({ magnets: [{ id: 10, hash: HASH_PREEXISTING }] })
                .mockResolvedValueOnce({ magnets: [
                    { id: 10, hash: HASH_PREEXISTING },
                    { id: 20, hash: HASH_UNCACHED }
                ] })
                .mockResolvedValueOnce({ magnets: [{ id: 10, hash: HASH_PREEXISTING }] }),
            uploadHashes: jest.fn().mockRejectedValue(new Error('response lost')),
            deleteMagnet: jest.fn().mockResolvedValue({ message: 'deleted' })
        };
        const service = new AllDebridAvailabilityService({ client, cleanupStore, historyStore, sleep: jest.fn() });

        await expect(service.check('key', [HASH_UNCACHED])).rejects.toThrow('response lost');
        expect(client.deleteMagnet).toHaveBeenCalledWith('key', '20');
        expect(await cleanupStore.load()).toEqual([]);
    });
});
