/* global describe, test, expect */

const {
    findMatchingDownloadRecord,
    findMatchingFailedDownloadRecord
} = require('../src/customStremio/downloadRecordMatching');

const payload = {
    metaId: 'tt123',
    videoId: 'tt123:1:2',
    downloadUrl: 'https://example.com/file.mkv'
};

describe('download record matching', () => {
    test('keeps failed records separate from active and completed records', () => {
        const failed = { ...payload, sourceUrl: payload.downloadUrl, id: 'failed', status: 'failed' };

        expect(findMatchingDownloadRecord([failed], payload)).toBeNull();
        expect(findMatchingFailedDownloadRecord([failed], payload)).toBe(failed);
    });

    test('does not apply an unrelated failed source to the visible stream row', () => {
        const failed = {
            ...payload,
            sourceUrl: 'https://example.com/different.mkv',
            id: 'failed',
            status: 'failed'
        };

        expect(findMatchingFailedDownloadRecord([failed], payload)).toBeNull();
    });
});
