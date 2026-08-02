/* global describe, test, expect */

const {
    formatPlaybackTime,
    getPlaybackProgressForRecord,
    findMostRecentPlaybackRecord
} = require('../src/customStremio/playbackProgressPresentation');

describe('playbackProgressPresentation', () => {
    test('formats playback time without treating it as a watched state', () => {
        expect(formatPlaybackTime(65_000)).toBe('1:05');
        expect(formatPlaybackTime(3_665_000)).toBe('1:01:05');
        expect(formatPlaybackTime(-1)).toBeNull();
    });

    test('uses only incomplete, positive progress for a completed download record', () => {
        const progress = getPlaybackProgressForRecord({ id: 'download-1', status: 'completed' }, {
            'download-1': { progress: 0.4839, positionMs: 3_055_757, durationMs: 6_314_815 }
        });

        expect(progress).toMatchObject({ percent: 48, positionLabel: '50:55', durationLabel: '1:45:14' });
        expect(getPlaybackProgressForRecord({ id: 'download-2', status: 'completed' }, {
            'download-2': { progress: 1, positionMs: 1, durationMs: 1 }
        })).toBeNull();
        expect(getPlaybackProgressForRecord({ id: 'download-3', status: 'failed' }, {
            'download-3': { progress: 0.5, positionMs: 1, durationMs: 2 }
        })).toBeNull();
    });

    test('prefers the most recently played incomplete completed record', () => {
        const records = [
            { id: 'older', status: 'completed' },
            { id: 'newer', status: 'completed' },
            { id: 'failed', status: 'failed' }
        ];
        const progressByDownloadId = {
            older: { progress: 0.2, lastPlayedAt: '2026-08-01T20:00:00.000Z' },
            newer: { progress: 0.4, lastPlayedAt: '2026-08-02T20:00:00.000Z' },
            failed: { progress: 0.8, lastPlayedAt: '2026-08-03T20:00:00.000Z' }
        };

        expect(findMostRecentPlaybackRecord(records, progressByDownloadId)?.id).toBe('newer');
    });
});
