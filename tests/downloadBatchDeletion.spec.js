/* global describe, test, expect, jest */

const {
    getSelectableDownloadIds,
    getSelectionState,
    groupSeriesRecordsByEpisode,
    executeDownloadMediaBatch
} = require('../src/customStremio/downloadBatchDeletion');

const makeError = (errorCode, extras = {}) => Object.assign(new Error(errorCode), {
    backendError: errorCode,
    responseBody: { errorCode, ...extras }
});

describe('download batch deletion', () => {
    test('selects only inactive records supported by destructive deletion', () => {
        const records = [
            { id: 'completed', status: 'completed' },
            { id: 'paused', status: 'paused' },
            { id: 'failed', status: 'failed' },
            { id: 'canceled', status: 'canceled' },
            { id: 'queued', status: 'queued' },
            { id: 'downloading', status: 'downloading' }
        ];

        expect(getSelectableDownloadIds(records)).toEqual(['completed', 'paused', 'failed', 'canceled']);
        expect(getSelectionState(records, new Set(['completed', 'failed']))).toMatchObject({
            selectableCount: 4,
            selectedCount: 2,
            allSelected: false,
            partiallySelected: true
        });
    });

    test('groups multiple series sources into one episode selection', () => {
        expect(groupSeriesRecordsByEpisode([
            { id: 'one-a', season: 1, episode: 1, videoTitle: 'Pilot' },
            { id: 'one-b', season: 1, episode: 1, videoTitle: 'Pilot' },
            { id: 'two', videoId: 'episode-two', season: 1, episode: 2, videoTitle: 'Next' }
        ])).toEqual([
            expect.objectContaining({ key: 'episode:1:1', title: 'Pilot', records: expect.arrayContaining([expect.objectContaining({ id: 'one-a' }), expect.objectContaining({ id: 'one-b' })]) }),
            expect.objectContaining({ key: 'video:episode-two', title: 'Next', records: [expect.objectContaining({ id: 'two' })] })
        ]);
    });

    test('deletes ordinary selected records sequentially', async () => {
        const order = [];
        const onStep = jest.fn();
        const result = await executeDownloadMediaBatch({
            records: [{ id: 'one', status: 'completed' }, { id: 'two', status: 'failed' }],
            recordIds: ['one', 'two'],
            deleteMedia: async (id) => order.push(`delete:${id}`),
            removeRecord: jest.fn(),
            cancelDownload: jest.fn(),
            onStep
        });

        expect(order).toEqual(['delete:one', 'delete:two']);
        expect(result.failures).toEqual([]);
        expect(result.successes).toHaveLength(2);
        expect(onStep).toHaveBeenLastCalledWith(expect.objectContaining({ completed: 2, total: 2 }));
    });

    test('removes selected duplicate records before the final shared file deletion', async () => {
        const existing = new Set(['one', 'two', 'three']);
        const deleteMedia = jest.fn(async (id) => {
            const sharedRecordIds = Array.from(existing).filter((candidate) => candidate !== id);
            if (sharedRecordIds.length > 0) {
                throw makeError('DOWNLOAD_MEDIA_SHARED_RECORDS', { sharedRecordIds });
            }
            existing.delete(id);
        });
        const removeRecord = jest.fn(async (id) => existing.delete(id));

        const result = await executeDownloadMediaBatch({
            records: ['one', 'two', 'three'].map((id) => ({ id, status: 'canceled' })),
            recordIds: ['one', 'two', 'three'],
            deleteMedia,
            removeRecord,
            cancelDownload: jest.fn()
        });

        expect(result.failures).toEqual([]);
        expect(result.successes.map(({ mode }) => mode)).toEqual(['duplicate_record', 'duplicate_record', 'media']);
        expect(removeRecord).toHaveBeenCalledTimes(2);
        expect(existing.size).toBe(0);
    });

    test('does not remove a duplicate record when another reference was not selected', async () => {
        const removeRecord = jest.fn();
        const result = await executeDownloadMediaBatch({
            records: [{ id: 'one', status: 'completed' }, { id: 'two', status: 'completed' }],
            recordIds: ['one'],
            deleteMedia: async () => {
                throw makeError('DOWNLOAD_MEDIA_SHARED_RECORDS', { sharedRecordIds: ['two'] });
            },
            removeRecord,
            cancelDownload: jest.fn()
        });

        expect(result.successes).toEqual([]);
        expect(result.failures).toEqual([expect.objectContaining({ id: 'one', errorCode: 'DOWNLOAD_MEDIA_SHARED_RECORDS' })]);
        expect(removeRecord).not.toHaveBeenCalled();
    });

    test('cancels a selected paused duplicate before removing its record', async () => {
        const calls = [];
        const result = await executeDownloadMediaBatch({
            records: [{ id: 'paused', status: 'paused' }, { id: 'remaining', status: 'canceled' }],
            recordIds: ['paused', 'remaining'],
            deleteMedia: async (id) => {
                if (id === 'paused') {
                    throw makeError('DOWNLOAD_MEDIA_SHARED_RECORDS', { sharedRecordIds: ['remaining'] });
                }
                calls.push(`delete:${id}`);
            },
            cancelDownload: async (id) => calls.push(`cancel:${id}`),
            removeRecord: async (id) => calls.push(`remove:${id}`)
        });

        expect(result.failures).toEqual([]);
        expect(calls).toEqual(['cancel:paused', 'remove:paused', 'delete:remaining']);
    });
});
