/* global describe, beforeEach, afterEach, test, expect */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    AllDebridAvailabilityStore,
    CACHED_TTL_MS,
    UNCACHED_TTL_MS
} = require('../local-backend/allDebridAvailabilityStore');

const HASH_CACHED = '842783e3005495d5d1637f5364b59343c7844707';
const HASH_UNCACHED = '194257a7bf4eaea978f4b5b7fbd3b4efcdd99e43';

describe('AllDebridAvailabilityStore', () => {
    let tempDirectory;
    let filePath;

    beforeEach(() => {
        tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-stremio-ad-history-'));
        filePath = path.join(tempDirectory, 'history.json');
    });

    afterEach(() => {
        fs.rmSync(tempDirectory, { recursive: true, force: true });
    });

    test('persists and replaces observations by normalized hash', async () => {
        const store = new AllDebridAvailabilityStore({ filePath });
        const verifiedAt = '2026-07-18T12:00:00.000Z';
        await store.upsert([{
            hash: HASH_CACHED.toUpperCase(),
            status: 'cached',
            verifiedAt,
            expiresAt: new Date(Date.parse(verifiedAt) + CACHED_TTL_MS).toISOString(),
            source: 'explicit_check'
        }]);
        await store.upsert([{
            hash: HASH_CACHED,
            status: 'uncached',
            verifiedAt,
            expiresAt: new Date(Date.parse(verifiedAt) + UNCACHED_TTL_MS).toISOString(),
            source: 'placeholder_response'
        }, {
            hash: HASH_UNCACHED,
            status: 'uncached',
            verifiedAt,
            expiresAt: new Date(Date.parse(verifiedAt) + UNCACHED_TTL_MS).toISOString(),
            source: 'explicit_check'
        }]);

        const reloadedStore = new AllDebridAvailabilityStore({ filePath });
        await expect(reloadedStore.load()).resolves.toEqual([
            expect.objectContaining({ hash: HASH_CACHED, status: 'uncached', source: 'placeholder_response' }),
            expect.objectContaining({ hash: HASH_UNCACHED, status: 'uncached', source: 'explicit_check' })
        ]);
    });
});
