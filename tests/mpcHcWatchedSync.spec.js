/* global describe, test, expect, jest */

const {
    WATCHED_SYNC_LEDGER_KEY,
    getEligibleMovieSyncs,
    syncEligibleMovies
} = require('../src/customStremio/mpcHcWatchedSync');

const metaItem = {
    id: 'tt123',
    type: 'movie',
    name: 'Example Movie',
    poster: 'https://images.example/poster.jpg',
    links: [],
    behaviorHints: {}
};
const download = {
    id: 'dl-1',
    status: 'completed',
    type: 'movie',
    metaId: 'tt123',
    stremioMetaItem: metaItem
};
const progress = {
    contentKey: 'movie:tt123',
    downloadId: 'dl-1',
    mediaType: 'movie',
    progress: 0.95,
    durationMs: 6000000
};

const createStorage = () => {
    const values = new Map();
    return {
        getItem: (key) => values.get(key) || null,
        setItem: (key, value) => values.set(key, value)
    };
};

describe('MPC-HC watched synchronization', () => {
    test('requires a completed movie, verified duration, 90% progress, and matching native metadata', () => {
        expect(getEligibleMovieSyncs({ downloads: [download], progressRecords: [progress] })).toHaveLength(1);
        expect(getEligibleMovieSyncs({
            downloads: [{ ...download, stremioMetaItem: null, parentTitle: 'Legacy Movie' }],
            progressRecords: [progress]
        })[0].metaItem).toMatchObject({ id: 'tt123', type: 'movie', name: 'Legacy Movie' });
        expect(getEligibleMovieSyncs({ downloads: [{ ...download, status: 'downloading' }], progressRecords: [progress] })).toHaveLength(0);
        expect(getEligibleMovieSyncs({ downloads: [download], progressRecords: [{ ...progress, progress: 0.899 }] })).toHaveLength(0);
        expect(getEligibleMovieSyncs({ downloads: [download], progressRecords: [{ ...progress, durationMs: null }] })).toHaveLength(0);
        expect(getEligibleMovieSyncs({ downloads: [{ ...download, stremioMetaItem: { ...metaItem, id: 'wrong' } }], progressRecords: [progress] })).toHaveLength(0);
    });

    test('uses native Stremio actions once and persists a deduplication ledger', () => {
        const dispatch = jest.fn();
        const storage = createStorage();
        const first = syncEligibleMovies({
            core: { transport: { dispatch } },
            downloads: [download],
            progressRecords: [progress],
            storage
        });

        expect(first.synced).toEqual(['movie:tt123']);
        expect(dispatch).toHaveBeenNthCalledWith(1, {
            action: 'Ctx',
            args: { action: 'AddToLibrary', args: expect.objectContaining({ id: 'tt123', type: 'movie' }) }
        });
        expect(dispatch).toHaveBeenNthCalledWith(2, {
            action: 'Ctx',
            args: {
                action: 'MetaItemMarkAsWatched',
                args: { meta_item: expect.objectContaining({ id: 'tt123' }), is_watched: true }
            }
        });
        expect(JSON.parse(storage.getItem(WATCHED_SYNC_LEDGER_KEY))).toHaveProperty('movie:tt123');

        syncEligibleMovies({
            core: { transport: { dispatch } },
            downloads: [download],
            progressRecords: [progress],
            storage
        });
        expect(dispatch).toHaveBeenCalledTimes(2);
    });
});
