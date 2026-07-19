/* global jest, describe, afterEach, test, expect */

const {
    parseContentRange,
    buildProgressUpdate,
    classifyKnownPlaceholderSourceUrl,
    isKnownNotReadySourceUrl
} = require('../local-backend/downloadManager');

describe('downloadManager range helpers', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('parses valid single byte content ranges', () => {
        expect(parseContentRange('bytes 100-199/500')).toEqual({ start: 100, end: 199, total: 500 });
        expect(parseContentRange('bytes 0-99/*')).toEqual({ start: 0, end: 99, total: null });
    });

    test('rejects malformed or impossible content ranges', () => {
        expect(parseContentRange('bytes */500')).toBe(null);
        expect(parseContentRange('items 0-10/20')).toBe(null);
        expect(parseContentRange('bytes 100-99/500')).toBe(null);
        expect(parseContentRange('bytes 0-500/500')).toBe(null);
    });

    test('calculates resumed speed from session bytes without inflating it by the saved offset', () => {
        jest.spyOn(Date, 'now').mockReturnValue(3000);

        expect(buildProgressUpdate({
            bytesDownloaded: 300,
            bytesTotal: 500,
            startedAt: 1000,
            initialBytesDownloaded: 100,
            localPath: 'C:\\Downloads\\Movie.mp4',
            partialPath: 'C:\\Downloads\\Movie.mp4.part'
        })).toEqual({
            localPath: 'C:\\Downloads\\Movie.mp4',
            partialPath: 'C:\\Downloads\\Movie.mp4.part',
            bytesDownloaded: 300,
            bytesTotal: 500,
            progress: 60,
            speedBytesPerSecond: 100,
            etaSeconds: 2
        });
    });

    test('recognizes Torrentio not-ready placeholder redirects without flagging normal media', () => {
        expect(isKnownNotReadySourceUrl('https://torrentio.strem.fun/videos/downloading_v2.mp4')).toBe(true);
        expect(isKnownNotReadySourceUrl('https://torrentio.strem.fun/videos/downloading.mp4?source=ad')).toBe(true);
        expect(isKnownNotReadySourceUrl('https://torrentio.strem.fun/videos/downloading_v12.mp4')).toBe(true);
        expect(isKnownNotReadySourceUrl('https://torrentio.strem.fun/videos/failed_infringement_v2.mp4')).toBe(true);
        expect(isKnownNotReadySourceUrl('https://torrentio.strem.fun/videos/failed_file-unavailable_v12.mp4')).toBe(true);
        expect(isKnownNotReadySourceUrl('https://torrentio.strem.fun/videos/movie.mkv')).toBe(false);
        expect(isKnownNotReadySourceUrl('https://media.example/videos/downloading_v2.mp4')).toBe(false);
        expect(classifyKnownPlaceholderSourceUrl('https://torrentio.strem.fun/videos/failed_infringement_v2.mp4')).toEqual({
            status: 'unavailable',
            errorCode: 'SOURCE_UNAVAILABLE',
            reason: 'infringement'
        });
    });
});
