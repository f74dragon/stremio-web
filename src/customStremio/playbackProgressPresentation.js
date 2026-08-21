const clampProgress = (value) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? Math.min(1, Math.max(0, numericValue)) : null;
};

const formatPlaybackTime = (value) => {
    const milliseconds = Number(value);
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
        return null;
    }

    const seconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    return hours > 0 ?
        `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
        :
        `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
};

const formatRemainingPlaybackTime = (positionMs, durationMs) => {
    if (positionMs === null || durationMs === null) {
        return null;
    }

    const position = Number(positionMs);
    const duration = Number(durationMs);
    if (!Number.isFinite(position) || !Number.isFinite(duration) || position < 0 || duration < position) {
        return null;
    }

    return formatPlaybackTime(duration - position);
};

const getPlaybackProgressForRecord = (record, progressByDownloadId) => {
    if (record?.status !== 'completed') {
        return null;
    }

    const progress = progressByDownloadId?.[record?.id];
    const value = clampProgress(progress?.progress);
    if (!progress || value === null || value <= 0 || value >= 1) {
        return null;
    }

    return {
        ...progress,
        value,
        percent: Math.round(value * 100),
        positionLabel: formatPlaybackTime(progress.positionMs),
        durationLabel: formatPlaybackTime(progress.durationMs),
        remainingLabel: formatRemainingPlaybackTime(progress.positionMs, progress.durationMs)
    };
};

const findMostRecentPlaybackRecord = (records, progressByDownloadId) => {
    return (records || []).reduce((latest, record) => {
        if (record?.status !== 'completed' || !getPlaybackProgressForRecord(record, progressByDownloadId)) {
            return latest;
        }

        const currentObservedAt = Date.parse(progressByDownloadId?.[record.id]?.lastPlayedAt || progressByDownloadId?.[record.id]?.lastObservedAt || '');
        const latestObservedAt = Date.parse(progressByDownloadId?.[latest?.id]?.lastPlayedAt || progressByDownloadId?.[latest?.id]?.lastObservedAt || '');
        return !latest || (Number.isFinite(currentObservedAt) && (!Number.isFinite(latestObservedAt) || currentObservedAt > latestObservedAt)) ? record : latest;
    }, null);
};

module.exports = {
    formatPlaybackTime,
    formatRemainingPlaybackTime,
    getPlaybackProgressForRecord,
    findMostRecentPlaybackRecord
};
