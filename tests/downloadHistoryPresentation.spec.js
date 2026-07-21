/* global describe, test, expect */

const {
    HISTORY_FILTERS,
    HISTORY_LIBRARY_SORTS,
    getAttemptOutcome,
    projectDownloadHistory,
    filterDownloadHistoryGroups,
    getDownloadHistoryFilterCounts,
    groupHistoryAttemptsBySeason,
    filterAndSortDownloadHistoryGroups
} = require('../src/customStremio/downloadHistoryPresentation');

const createEvent = ({
    eventType,
    downloadId = 'download-1',
    attemptCount = 1,
    occurredAt = '2026-07-20T12:00:00.000Z',
    status = 'completed',
    type = 'movie',
    metaId = 'tt-history',
    title = 'History Movie',
    videoId = null,
    videoTitle = null,
    season = null,
    episode = null
}) => ({
    eventType,
    downloadId,
    occurredAt,
    record: {
        media: { type, metaId, title, videoId, videoTitle, season, episode, poster: 'https://images.example/poster.jpg' },
        source: { addonName: 'Torrentio', provider: 'realdebrid', streamName: '1080p', fileName: 'Movie.mkv' },
        result: { status, attemptCount, bytesTotal: 1024 }
    },
    details: {}
});

describe('download history presentation', () => {
    test('projects retries into distinct attempts under one title', () => {
        const groups = projectDownloadHistory([
            createEvent({ eventType: 'download_created', status: 'queued', occurredAt: '2026-07-20T10:00:00.000Z' }),
            createEvent({ eventType: 'download_failed', status: 'failed', occurredAt: '2026-07-20T10:05:00.000Z' }),
            createEvent({ eventType: 'download_retried', attemptCount: 2, status: 'queued', occurredAt: '2026-07-20T11:00:00.000Z' }),
            createEvent({ eventType: 'download_completed', attemptCount: 2, occurredAt: '2026-07-20T11:05:00.000Z' })
        ], [{ id: 'download-1', attemptCount: 2 }]);

        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({ title: 'History Movie', attemptCount: 2, latestOutcome: 'completed', currentCount: 1 });
        expect(groups[0].attempts.map(({ attemptNumber, outcome, current }) => ({ attemptNumber, outcome, current }))).toEqual([
            { attemptNumber: 2, outcome: 'completed', current: true },
            { attemptNumber: 1, outcome: 'failed', current: false }
        ]);
    });

    test('successful deletion overrides an earlier completion while a request alone does not', () => {
        const completed = createEvent({ eventType: 'download_completed' });
        const requested = createEvent({ eventType: 'media_deletion_requested', occurredAt: '2026-07-20T12:05:00.000Z' });
        const deleted = createEvent({ eventType: 'media_deleted', occurredAt: '2026-07-20T12:06:00.000Z' });
        expect(getAttemptOutcome([completed, requested])).toBe('completed');
        expect(getAttemptOutcome([completed, requested, deleted])).toBe('deleted');
    });

    test('groups series history by season and episode across source attempts', () => {
        const groups = projectDownloadHistory([
            createEvent({ eventType: 'download_completed', downloadId: 'episode-1-a', type: 'series', videoId: 's1e1', videoTitle: 'Pilot', season: 1, episode: 1 }),
            createEvent({ eventType: 'download_failed', downloadId: 'episode-1-b', type: 'series', videoId: 's1e1', videoTitle: 'Pilot', season: 1, episode: 1, status: 'failed' }),
            createEvent({ eventType: 'download_completed', downloadId: 'episode-2', type: 'series', videoId: 's2e1', videoTitle: 'Return', season: 2, episode: 1 })
        ]);
        expect(groups[0].episodeCount).toBe(2);
        const seasons = groupHistoryAttemptsBySeason(groups[0].attempts);
        expect(seasons.map(({ season, episodes }) => ({ season, episodes: episodes.length }))).toEqual([
            { season: 1, episodes: 1 },
            { season: 2, episodes: 1 }
        ]);
        expect(seasons[0].episodes[0].attempts).toHaveLength(2);
    });

    test('filters title cards when any attempt matches the requested outcome', () => {
        const groups = projectDownloadHistory([
            createEvent({ eventType: 'download_completed', downloadId: 'completed', metaId: 'tt-completed', title: 'Completed Movie' }),
            createEvent({ eventType: 'download_failed', downloadId: 'failed', metaId: 'tt-failed', title: 'Failed Movie', status: 'failed' }),
            createEvent({ eventType: 'media_deleted', downloadId: 'deleted', metaId: 'tt-deleted', title: 'Deleted Movie' })
        ]);
        expect(filterDownloadHistoryGroups(groups, HISTORY_FILTERS.COMPLETED).map(({ title }) => title)).toEqual(['Completed Movie']);
        expect(filterDownloadHistoryGroups(groups, HISTORY_FILTERS.ATTENTION).map(({ title }) => title)).toEqual(['Failed Movie']);
        expect(filterDownloadHistoryGroups(groups, HISTORY_FILTERS.DELETED).map(({ title }) => title)).toEqual(['Deleted Movie']);
        expect(getDownloadHistoryFilterCounts(groups)).toEqual({ all: 3, completed: 1, attention: 1, deleted: 1 });
    });

    test('combines outcome filtering, title or episode search, and stable sorting', () => {
        const groups = projectDownloadHistory([
            createEvent({ eventType: 'download_completed', downloadId: 'zulu', metaId: 'zulu', title: 'Zulu Movie', occurredAt: '2026-07-19T12:00:00.000Z' }),
            createEvent({ eventType: 'download_completed', downloadId: 'show-1', metaId: 'show', title: 'Example Show', type: 'series', videoId: 'show:2:5', videoTitle: 'The Return', season: 2, episode: 5, occurredAt: '2026-07-20T12:00:00.000Z' }),
            createEvent({ eventType: 'download_failed', downloadId: 'show-2', metaId: 'show', title: 'Example Show', type: 'series', videoId: 'show:2:6', videoTitle: 'Aftermath', season: 2, episode: 6, status: 'failed', occurredAt: '2026-07-21T12:00:00.000Z' }),
            createEvent({ eventType: 'download_completed', downloadId: 'alpha', metaId: 'alpha', title: 'Alpha Movie', occurredAt: '2026-07-18T12:00:00.000Z' })
        ]);

        expect(filterAndSortDownloadHistoryGroups(groups, { query: 'example s02e05' }).map(({ title }) => title)).toEqual(['Example Show']);
        expect(filterAndSortDownloadHistoryGroups(groups, { filter: HISTORY_FILTERS.ATTENTION, query: 'aftermath' }).map(({ title }) => title)).toEqual(['Example Show']);
        expect(filterAndSortDownloadHistoryGroups(groups, { sort: HISTORY_LIBRARY_SORTS.TITLE_ASC }).map(({ title }) => title)).toEqual(['Alpha Movie', 'Example Show', 'Zulu Movie']);
        expect(filterAndSortDownloadHistoryGroups(groups, { sort: HISTORY_LIBRARY_SORTS.OLDEST }).map(({ title }) => title)).toEqual(['Alpha Movie', 'Zulu Movie', 'Example Show']);
        expect(filterAndSortDownloadHistoryGroups(groups, { sort: HISTORY_LIBRARY_SORTS.ATTEMPTS_DESC }).map(({ title }) => title)[0]).toBe('Example Show');
    });

    test('ignores malformed events instead of creating broken cards', () => {
        expect(projectDownloadHistory([null, {}, { downloadId: 'missing-record', eventType: 'download_failed' }])).toEqual([]);
    });
});
