/* global describe, test, expect */

const {
    BATCH_PROVIDER_POLICY,
    getBatchSourceQualityRank,
    sortBatchSourceCandidates,
    hasHigherPriorityUnverifiedBatchSource,
    createBatchDownloadSession,
    assignBatchDownloadSource,
    markBatchDownloadAssignmentSubmitted,
    getNextUnassignedBatchEpisode,
    getBatchDownloadAssignments,
    readBatchDownloadSession,
    writeBatchDownloadSession
} = require('../src/customStremio/batchDownloadSelection');
const { DEBRID_PROVIDER, SOURCE_READINESS } = require('../src/customStremio/debridSourceReadiness');

const candidate = ({ name, size, provider = DEBRID_PROVIDER.ALLDEBRID, readiness = SOURCE_READINESS.CACHED }) => ({
    name,
    size,
    provider,
    readiness,
    payload: { streamName: name, behaviorHints: { videoSize: size } }
});

describe('batch download selection', () => {
    test('ranks premium 4K HDR first, then 4K, 1080p, and 720p', () => {
        const sources = [
            candidate({ name: '720p', size: 20 }),
            candidate({ name: '1080p', size: 30 }),
            candidate({ name: '4K', size: 10 }),
            candidate({ name: '2160p HDR10', size: 5 })
        ];
        expect(sortBatchSourceCandidates(sources).map(({ name }) => name)).toEqual(['2160p HDR10', '4K', '1080p', '720p']);
        expect(getBatchSourceQualityRank(candidate({ name: '4K Dolby Vision' }))).toBe(0);
    });

    test('prefers the larger file only within the same quality tier', () => {
        const sources = [
            candidate({ name: '1080p small', size: 100 }),
            candidate({ name: '1080p large', size: 300 }),
            candidate({ name: '720p huge', size: 1000 })
        ];
        expect(sortBatchSourceCandidates(sources).map(({ name }) => name)).toEqual(['1080p large', '1080p small', '720p huge']);
    });

    test('filters blocked and disallowed provider sources', () => {
        const sources = [
            candidate({ name: 'AD ready', provider: DEBRID_PROVIDER.ALLDEBRID }),
            candidate({ name: 'RD ready', provider: DEBRID_PROVIDER.REALDEBRID }),
            candidate({ name: 'RD uncached', provider: DEBRID_PROVIDER.REALDEBRID, readiness: SOURCE_READINESS.REQUIRES_CACHING })
        ];
        expect(sortBatchSourceCandidates(sources, { providerPolicy: BATCH_PROVIDER_POLICY.REALDEBRID }).map(({ name }) => name)).toEqual(['RD ready']);
    });

    test('requires checking a higher-priority unknown source before recommending a lower cached source', () => {
        const cached1080p = candidate({ name: '1080p cached', size: 300 });
        const unknown4k = candidate({ name: '4K unchecked', size: 200, readiness: SOURCE_READINESS.UNKNOWN });
        const uncached4k = candidate({ name: '4K not cached', size: 200, readiness: SOURCE_READINESS.REQUIRES_CACHING });
        expect(hasHigherPriorityUnverifiedBatchSource([cached1080p, unknown4k], cached1080p)).toBe(true);
        expect(hasHigherPriorityUnverifiedBatchSource([cached1080p, uncached4k], cached1080p)).toBe(false);
    });

    test('tracks assignments in episode order and enters review when complete', () => {
        let session = createBatchDownloadSession({
            metaId: 'show',
            parentTitle: 'Example Show',
            episodes: [
                { id: 'show:1:1', title: 'Pilot', season: 1, episode: 1, href: '#/metadetails/series/show/show%3A1%3A1' },
                { id: 'show:1:2', title: 'Next', season: 1, episode: 2, href: '#/metadetails/series/show/show%3A1%3A2' }
            ]
        });
        expect(getNextUnassignedBatchEpisode(session)?.id).toBe('show:1:1');
        session = assignBatchDownloadSource(session, 'show:1:1', candidate({ name: 'Episode one 1080p', size: 100 }));
        expect(session.status).toBe('collecting');
        expect(getNextUnassignedBatchEpisode(session)?.id).toBe('show:1:2');
        session = assignBatchDownloadSource(session, 'show:1:2', candidate({ name: 'Episode two 4K', size: 200 }));
        expect(session.status).toBe('review');
        expect(getBatchDownloadAssignments(session).map(({ episode }) => episode.id)).toEqual(['show:1:1', 'show:1:2']);
        session = markBatchDownloadAssignmentSubmitted(session, 'show:1:1', { id: 'record-1' });
        expect(session.assignments['show:1:1']).toMatchObject({ submitted: true, recordId: 'record-1' });
        expect(session.assignments['show:1:2'].submitted).toBeUndefined();
    });

    test('persists only the session for the requested title', () => {
        const values = new Map();
        const storage = {
            getItem: (key) => values.get(key) || null,
            setItem: (key, value) => values.set(key, value),
            removeItem: (key) => values.delete(key)
        };
        const session = createBatchDownloadSession({
            metaId: 'show',
            episodes: [{ id: 'show:1:1', href: '#/episode/1' }]
        });
        expect(writeBatchDownloadSession(storage, session)).toBe(true);
        expect(readBatchDownloadSession(storage, 'show')?.metaId).toBe('show');
        expect(readBatchDownloadSession(storage, 'other')).toBe(null);
        expect(writeBatchDownloadSession(storage, null)).toBe(true);
        expect(readBatchDownloadSession(storage, 'show')).toBe(null);
    });
});
