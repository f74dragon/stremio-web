/* global describe, test, expect */

const {
    sortDownloadRecordsNewestFirst,
    groupDownloadRecords,
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

    test('builds title and episode detail links only when metadata is sufficient', () => {
        expect(getDownloadDetailsHref({ type: 'movie', metaId: 'tt123' })).toBe('#/metadetails/movie/tt123');
        expect(getDownloadDetailsHref({ type: 'series', metaId: 'tt456', videoId: 'tt456:1:2' }))
            .toBe('#/metadetails/series/tt456/tt456%3A1%3A2');
        expect(getDownloadDetailsHref({ type: 'series' })).toBe(null);
    });
});
