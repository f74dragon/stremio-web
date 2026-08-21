/* global describe, test, expect */

const {
    buildLocalContinueWatchingItems,
    mergeLocalContinueWatching
} = require('../src/customStremio/continueWatchingPresentation');

const episode = (id, season, number) => ({
    id,
    status: 'completed',
    type: 'series',
    metaId: 'tt-series',
    parentTitle: 'Example Show',
    season,
    episode: number,
    poster: 'poster.jpg'
});

describe('local Continue Watching presentation', () => {
    test('projects verified partial progress and advances a near-end series episode locally', () => {
        const downloads = [episode('one', 1, 1), episode('two', 1, 2)];
        const partial = buildLocalContinueWatchingItems(downloads, [{
            downloadId: 'one', metaId: 'tt-series', mediaType: 'series', videoId: undefined,
            positionMs: 42000, durationMs: 100000, progress: 0.42, lastPlayedAt: '2026-08-20T01:00:00Z'
        }]);
        expect(partial[0]).toMatchObject({ _id: 'tt-series', progress: 42, customStremioLocal: true });

        const advanced = buildLocalContinueWatchingItems(downloads, [{
            downloadId: 'one', metaId: 'tt-series', mediaType: 'series', videoId: undefined,
            positionMs: 95000, durationMs: 100000, progress: 0.95, lastPlayedAt: '2026-08-20T01:00:00Z'
        }]);
        expect(advanced[0]).toMatchObject({ name: 'Example Show · S1 E2', progress: 1 });
    });

    test('replaces a matching native preview without duplicating the title', () => {
        const merged = mergeLocalContinueWatching({ items: [{ _id: 'tt-series', name: 'Native' }] }, [episode('one', 1, 1)], [{
            downloadId: 'one', metaId: 'tt-series', mediaType: 'series', videoId: undefined,
            positionMs: 50000, durationMs: 100000, progress: 0.5, lastPlayedAt: '2026-08-20T01:00:00Z'
        }]);
        expect(merged.items).toHaveLength(1);
        expect(merged.items[0]).toMatchObject({ _id: 'tt-series', progress: 50, customStremioLocal: true });
    });
});
