/* global describe, test, expect */

const {
    sortDownloadRecordsNewestFirst,
    getQueuePosition,
    sortActiveDownloadRecords,
    getLatestCompletedRecord,
    groupDownloadRecords,
    groupDownloadRecordsByMedia,
    sortMediaGroupRecords,
    getSeriesEpisodeCount,
    groupSeriesRecordsBySeason,
    getDownloadActivitySummary,
    getDownloadTitleHref,
    getDownloadDetailsHref
} = require('../src/customStremio/downloadRecordPresentation');

describe('downloadRecordPresentation', () => {
    test('groups records by user-facing state and sorts each group newest first', () => {
        const groups = groupDownloadRecords([
            { id: 'completed-old', status: 'completed', completedAt: '2026-01-01T00:00:00.000Z' },
            { id: 'failed', status: 'failed', updatedAt: '2026-04-01T00:00:00.000Z' },
            { id: 'active-old', status: 'queued', updatedAt: '2026-02-01T00:00:00.000Z' },
            { id: 'completed-new', status: 'completed', completedAt: '2026-05-01T00:00:00.000Z' },
            { id: 'active-new', status: 'downloading', updatedAt: '2026-03-01T00:00:00.000Z' },
            { id: 'canceled', status: 'canceled', updatedAt: '2026-06-01T00:00:00.000Z' }
        ]);

        expect(groups.active.map(({ id }) => id)).toEqual(['active-new', 'active-old']);
        expect(groups.completed.map(({ id }) => id)).toEqual(['completed-new', 'completed-old']);
        expect(groups.attention.map(({ id }) => id)).toEqual(['canceled', 'failed']);
    });

    test('does not mutate records while sorting', () => {
        const records = [
            { id: 'older', updatedAt: '2026-01-01T00:00:00.000Z' },
            { id: 'newer', updatedAt: '2026-02-01T00:00:00.000Z' }
        ];

        expect(sortDownloadRecordsNewestFirst(records).map(({ id }) => id)).toEqual(['newer', 'older']);
        expect(records.map(({ id }) => id)).toEqual(['older', 'newer']);
    });

    test('orders active transfers before FIFO queue positions and paused work', () => {
        const records = [
            { id: 'paused', status: 'paused', updatedAt: '2026-07-17T12:05:00.000Z' },
            { id: 'queued-second', status: 'queued', queuePosition: 2, updatedAt: '2026-07-17T12:04:00.000Z' },
            { id: 'downloading', status: 'downloading', updatedAt: '2026-07-17T12:01:00.000Z' },
            { id: 'queued-first', status: 'queued', queuePosition: 1, updatedAt: '2026-07-17T12:03:00.000Z' }
        ];

        expect(sortActiveDownloadRecords(records).map(({ id }) => id)).toEqual([
            'downloading',
            'queued-first',
            'queued-second',
            'paused'
        ]);
        expect(getQueuePosition(records[1])).toBe(2);
        expect(getQueuePosition({ queuePosition: 0 })).toBe(null);
        expect(records.map(({ id }) => id)).toEqual(['paused', 'queued-second', 'downloading', 'queued-first']);
    });

    test('selects the newest completed record for direct movie playback', () => {
        const records = [
            { id: 'completed-old', status: 'completed', completedAt: '2026-01-01T00:00:00.000Z' },
            { id: 'active-newer', status: 'downloading', updatedAt: '2026-03-01T00:00:00.000Z' },
            { id: 'completed-new', status: 'completed', completedAt: '2026-02-01T00:00:00.000Z' }
        ];

        expect(getLatestCompletedRecord(records)?.id).toBe('completed-new');
        expect(getLatestCompletedRecord([{ id: 'failed', status: 'failed' }])).toBe(null);
        expect(getLatestCompletedRecord(null)).toBe(null);
    });

    test('builds title and episode detail links only when metadata is sufficient', () => {
        expect(getDownloadTitleHref({ type: 'series', metaId: 'tt456', videoId: 'tt456:1:2' }))
            .toBe('#/metadetails/series/tt456');
        expect(getDownloadDetailsHref({ type: 'movie', metaId: 'tt123' })).toBe('#/metadetails/movie/tt123');
        expect(getDownloadDetailsHref({ type: 'series', metaId: 'tt456', videoId: 'tt456:1:2' }))
            .toBe('#/metadetails/series/tt456/tt456%3A1%3A2');
        expect(getDownloadDetailsHref({ type: 'series' })).toBe(null);
    });

    test('groups downloads by title and preserves media artwork and aggregate statuses', () => {
        const groups = groupDownloadRecordsByMedia([
            {
                id: 'show-episode-2',
                metaId: 'tt-show',
                type: 'series',
                parentTitle: 'Example Show',
                poster: 'https://images.example/show-poster.jpg',
                background: 'https://images.example/show-background.jpg',
                logo: 'https://images.example/show-logo.png',
                description: 'Example summary',
                runtime: '45 min',
                releaseInfo: '2025-',
                titleReleased: '2025-01-01T00:00:00.000Z',
                metaLinks: [{ category: 'Genres', name: 'Drama', url: 'stremio:///discover/drama' }],
                videoThumbnail: 'https://images.example/episode-2.jpg',
                videoId: 'tt-show:1:2',
                season: 1,
                episode: 2,
                status: 'downloading',
                updatedAt: '2026-07-15T12:00:00.000Z'
            },
            {
                id: 'movie',
                metaId: 'tt-movie',
                type: 'movie',
                parentTitle: 'Example Movie',
                status: 'completed',
                updatedAt: '2026-07-14T12:00:00.000Z'
            },
            {
                id: 'show-episode-1',
                metaId: 'tt-show',
                type: 'series',
                parentTitle: 'Example Show',
                videoId: 'tt-show:1:1',
                season: 1,
                episode: 1,
                status: 'completed',
                updatedAt: '2026-07-13T12:00:00.000Z'
            }
        ]);

        expect(groups).toHaveLength(2);
        expect(groups[0]).toMatchObject({
            key: 'series:id:tt-show',
            title: 'Example Show',
            poster: 'https://images.example/show-poster.jpg',
            background: 'https://images.example/show-background.jpg',
            logo: 'https://images.example/show-logo.png',
            description: 'Example summary',
            runtime: '45 min',
            releaseInfo: '2025-',
            titleReleased: '2025-01-01T00:00:00.000Z',
            metaLinks: [{ category: 'Genres', name: 'Drama', url: 'stremio:///discover/drama' }],
            activeCount: 1,
            completedCount: 1,
            attentionCount: 0,
            latestCompletedRecord: expect.objectContaining({ id: 'show-episode-1' }),
            href: '#/metadetails/series/tt-show'
        });
        expect(groups[0].records.map(({ id }) => id)).toEqual(['show-episode-1', 'show-episode-2']);
        expect(groups[1].title).toBe('Example Movie');
    });

    test('uses title grouping and artwork fallbacks without mutating legacy records', () => {
        const records = [
            { id: 'legacy-2', type: 'series', parentTitle: 'Legacy Show', season: 2, episode: 1, status: 'failed' },
            { id: 'legacy-1', type: 'series', parentTitle: 'Legacy Show', season: 1, episode: 8, status: 'completed' }
        ];
        const groups = groupDownloadRecordsByMedia(records);

        expect(groups).toEqual([
            expect.objectContaining({
                key: 'series:title:legacy show',
                poster: null,
                background: null,
                activeCount: 0,
                completedCount: 1,
                attentionCount: 1
            })
        ]);
        expect(groups[0].records.map(({ id }) => id)).toEqual(['legacy-1', 'legacy-2']);
        expect(records.map(({ id }) => id)).toEqual(['legacy-2', 'legacy-1']);
    });

    test('sorts movie records newest-first and series records by season and episode', () => {
        const records = [
            { id: 'later-episode', season: 2, episode: 1, updatedAt: '2026-01-01T00:00:00.000Z' },
            { id: 'newer-record', season: 1, episode: 2, updatedAt: '2026-03-01T00:00:00.000Z' },
            { id: 'earlier-episode', season: 1, episode: 1, updatedAt: '2026-02-01T00:00:00.000Z' }
        ];

        expect(sortMediaGroupRecords(records, 'series').map(({ id }) => id))
            .toEqual(['earlier-episode', 'newer-record', 'later-episode']);
        expect(sortMediaGroupRecords(records, 'movie').map(({ id }) => id))
            .toEqual(['newer-record', 'earlier-episode', 'later-episode']);
    });

    test('counts unique episodes and separates show records by season', () => {
        const records = [
            { id: 's2e1', videoId: 'show:2:1', season: 2, episode: 1 },
            { id: 's1e2-copy', videoId: 'show:1:2', season: 1, episode: 2, updatedAt: '2026-02-01T00:00:00.000Z' },
            { id: 's1e1', videoId: 'show:1:1', season: 1, episode: 1 },
            { id: 's1e2', videoId: 'show:1:2', season: 1, episode: 2, updatedAt: '2026-01-01T00:00:00.000Z' },
            { id: 'special' }
        ];

        expect(getSeriesEpisodeCount(records)).toBe(4);
        expect(groupSeriesRecordsBySeason(records).map((group) => ({
            key: group.key,
            ids: group.records.map(({ id }) => id)
        }))).toEqual([
            { key: 'season:1', ids: ['s1e1', 's1e2-copy', 's1e2'] },
            { key: 'season:2', ids: ['s2e1'] },
            { key: 'season:unknown', ids: ['special'] }
        ]);
    });

    test('calculates byte-weighted global download activity', () => {
        const summary = getDownloadActivitySummary([
            { id: 'small', status: 'downloading', bytesDownloaded: 50, bytesTotal: 100, speedBytesPerSecond: 10 },
            { id: 'large', status: 'downloading', bytesDownloaded: 250, bytesTotal: 900, speedBytesPerSecond: 20 },
            { id: 'done', status: 'completed', bytesDownloaded: 500, bytesTotal: 500 }
        ]);

        expect(summary).toMatchObject({
            count: 2,
            downloadingCount: 2,
            queuedCount: 0,
            pausedCount: 0,
            bytesDownloaded: 300,
            bytesTotal: 1000,
            speedBytesPerSecond: 30,
            progress: 30,
            indeterminate: false
        });
        expect(summary.etaSeconds).toBeCloseTo(700 / 30);
        expect(summary.records.map(({ id }) => id)).toEqual(['small', 'large']);
    });

    test('calculates transfer progress independently from queued work', () => {
        expect(getDownloadActivitySummary([
            { id: 'known', status: 'downloading', bytesDownloaded: 50, bytesTotal: 100 },
            { id: 'unknown', status: 'queued', queuePosition: 1, bytesDownloaded: 0, bytesTotal: null }
        ])).toMatchObject({
            count: 2,
            downloadingCount: 1,
            queuedCount: 1,
            bytesTotal: 100,
            progress: 50,
            indeterminate: false,
            records: [
                expect.objectContaining({ id: 'known' }),
                expect.objectContaining({ id: 'unknown' })
            ]
        });
    });

    test('keeps an unknown-size active transfer indeterminate without counting paused bytes', () => {
        expect(getDownloadActivitySummary([
            { id: 'unknown', status: 'downloading', bytesDownloaded: 25, bytesTotal: null },
            { id: 'paused', status: 'paused', bytesDownloaded: 500, bytesTotal: 1000 }
        ])).toMatchObject({
            count: 2,
            downloadingCount: 1,
            queuedCount: 0,
            pausedCount: 1,
            bytesDownloaded: 25,
            bytesTotal: null,
            progress: null,
            indeterminate: true
        });
    });
});
