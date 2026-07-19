/* global describe, beforeEach, afterEach, test, expect */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    CACHED_TTL_MS,
    READY_TTL_MS,
    UNCACHED_TTL_MS,
    RealDebridAvailabilityStore
} = require('../local-backend/realDebridAvailabilityStore');

const HASH = '842783e3005495d5d1637f5364b59343c7844707';

describe('RealDebridAvailabilityStore', () => {
    let tempDirectory;
    let filePath;

    beforeEach(() => {
        tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-stremio-rd-history-'));
        filePath = path.join(tempDirectory, 'history.json');
    });

    afterEach(() => {
        fs.rmSync(tempDirectory, { recursive: true, force: true });
    });

    test('persists provider-specific source observations by exact key', async () => {
        const store = new RealDebridAvailabilityStore({ filePath });
        const verifiedAt = '2026-07-19T12:00:00.000Z';
        await store.upsert([{
            key: `${HASH}::0::episode.mkv::1000`,
            hash: HASH,
            fileIdx: 0,
            filename: 'Episode.mkv',
            videoSize: 1000,
            status: 'cached',
            verifiedAt,
            expiresAt: new Date(Date.parse(verifiedAt) + CACHED_TTL_MS).toISOString(),
            source: 'explicit_check'
        }, {
            key: `${HASH}::2::episode3.mkv::3000`,
            hash: HASH,
            fileIdx: 2,
            filename: 'Episode3.mkv',
            videoSize: 3000,
            status: 'ready',
            verifiedAt,
            expiresAt: new Date(Date.parse(verifiedAt) + READY_TTL_MS).toISOString(),
            source: 'resolver_head'
        }, {
            key: `${HASH}::1::episode2.mkv::2000`,
            hash: HASH,
            fileIdx: 1,
            filename: 'Episode2.mkv',
            videoSize: 2000,
            status: 'uncached',
            verifiedAt,
            expiresAt: new Date(Date.parse(verifiedAt) + UNCACHED_TTL_MS).toISOString(),
            source: 'explicit_check'
        }]);

        await expect(new RealDebridAvailabilityStore({ filePath }).load()).resolves.toEqual([
            expect.objectContaining({ fileIdx: 0, status: 'cached' }),
            expect.objectContaining({ fileIdx: 2, status: 'ready' }),
            expect.objectContaining({ fileIdx: 1, status: 'uncached' })
        ]);
    });
});
