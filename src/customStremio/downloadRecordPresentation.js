const ACTIVE_DOWNLOAD_STATUSES = new Set(['queued', 'downloading', 'paused']);
const POLLING_DOWNLOAD_STATUSES = new Set(['queued', 'downloading']);
const {
    matchesLibrarySearch,
    compareLibraryTitles,
    getEpisodeSearchValues
} = require('./librarySearchSort');

const DOWNLOAD_LIBRARY_SORTS = Object.freeze({
    RECENT: 'recent',
    OLDEST: 'oldest',
    TITLE_ASC: 'title-asc',
    TITLE_DESC: 'title-desc',
    SIZE_DESC: 'size-desc',
    CONTENT_DESC: 'content-desc'
});

const getTimestamp = (record) => {
    const value = record?.completedAt || record?.updatedAt || record?.createdAt;
    const timestamp = value ? new Date(value).getTime() : 0;
    return Number.isFinite(timestamp) ? timestamp : 0;
};

const sortDownloadRecordsNewestFirst = (records) => {
    return [...records].sort((left, right) => getTimestamp(right) - getTimestamp(left));
};

const getQueuePosition = (record) => {
    const position = Number(record?.queuePosition);
    return Number.isSafeInteger(position) && position >= 1 ? position : null;
};

const sortActiveDownloadRecords = (records) => {
    const statusOrder = new Map([
        ['downloading', 0],
        ['queued', 1],
        ['paused', 2]
    ]);

    return [...records].sort((left, right) => {
        const leftStatusOrder = statusOrder.get(left?.status) ?? Number.MAX_SAFE_INTEGER;
        const rightStatusOrder = statusOrder.get(right?.status) ?? Number.MAX_SAFE_INTEGER;
        if (leftStatusOrder !== rightStatusOrder) {
            return leftStatusOrder - rightStatusOrder;
        }

        if (left?.status === 'queued' && right?.status === 'queued') {
            const leftPosition = getQueuePosition(left) ?? Number.MAX_SAFE_INTEGER;
            const rightPosition = getQueuePosition(right) ?? Number.MAX_SAFE_INTEGER;
            if (leftPosition !== rightPosition) {
                return leftPosition - rightPosition;
            }
        }

        return getTimestamp(right) - getTimestamp(left);
    });
};

const getLatestCompletedRecord = (records) => {
    if (!Array.isArray(records)) {
        return null;
    }

    return sortDownloadRecordsNewestFirst(records.filter((record) => record?.status === 'completed'))[0] || null;
};

const normalizeGroupValue = (value) => typeof value === 'string' ? value.trim() : '';

const getDownloadMediaKey = (record, index) => {
    const type = normalizeGroupValue(record?.type).toLowerCase() || 'unknown';
    const metaId = normalizeGroupValue(record?.metaId);
    if (metaId) {
        return `${type}:id:${metaId}`;
    }

    const title = normalizeGroupValue(record?.parentTitle || record?.videoTitle).toLowerCase();
    if (title) {
        return `${type}:title:${title}`;
    }

    return `record:${normalizeGroupValue(record?.id) || index}`;
};

const sortMediaGroupRecords = (records, type) => {
    if (type !== 'series') {
        return sortDownloadRecordsNewestFirst(records);
    }

    return [...records].sort((left, right) => {
        const leftSeason = typeof left?.season === 'number' ? left.season : Number.MAX_SAFE_INTEGER;
        const rightSeason = typeof right?.season === 'number' ? right.season : Number.MAX_SAFE_INTEGER;
        const leftEpisode = typeof left?.episode === 'number' ? left.episode : Number.MAX_SAFE_INTEGER;
        const rightEpisode = typeof right?.episode === 'number' ? right.episode : Number.MAX_SAFE_INTEGER;

        return leftSeason - rightSeason || leftEpisode - rightEpisode || getTimestamp(right) - getTimestamp(left);
    });
};

const getSeriesEpisodeCount = (records) => {
    if (!Array.isArray(records)) {
        return 0;
    }

    const episodeKeys = new Set();
    records.forEach((record, index) => {
        const videoId = normalizeGroupValue(record?.videoId);
        const hasSeasonAndEpisode = typeof record?.season === 'number' && typeof record?.episode === 'number';
        const key = videoId || (hasSeasonAndEpisode ? `${record.season}:${record.episode}` : normalizeGroupValue(record?.id) || `record:${index}`);
        episodeKeys.add(key);
    });

    return episodeKeys.size;
};

const groupSeriesRecordsBySeason = (records) => {
    if (!Array.isArray(records)) {
        return [];
    }

    const seasonGroups = new Map();
    sortMediaGroupRecords(records, 'series').forEach((record) => {
        const season = typeof record?.season === 'number' ? record.season : null;
        const key = season === null ? 'season:unknown' : `season:${season}`;
        const existingGroup = seasonGroups.get(key);
        if (existingGroup) {
            existingGroup.records.push(record);
        } else {
            seasonGroups.set(key, { key, season, records: [record] });
        }
    });

    return Array.from(seasonGroups.values());
};

const getDownloadActivitySummary = (records) => {
    const activeRecords = groupDownloadRecords(records).active;
    const downloadingRecords = activeRecords.filter((record) => record?.status === 'downloading');
    const hasKnownTotals = downloadingRecords.length > 0 && downloadingRecords.every((record) => Number(record?.bytesTotal) > 0);
    const bytesTotal = hasKnownTotals ? downloadingRecords.reduce((total, record) => total + Number(record.bytesTotal), 0) : null;
    const bytesDownloaded = downloadingRecords.reduce((total, record) => {
        const value = Number(record?.bytesDownloaded);
        return total + (Number.isFinite(value) && value > 0 ? value : 0);
    }, 0);
    const speedBytesPerSecond = downloadingRecords.reduce((total, record) => {
        const value = Number(record?.speedBytesPerSecond);
        return total + (Number.isFinite(value) && value > 0 ? value : 0);
    }, 0);
    const progress = bytesTotal ? Math.min(100, Math.max(0, (bytesDownloaded / bytesTotal) * 100)) : null;
    const remainingBytes = bytesTotal === null ? null : Math.max(0, bytesTotal - bytesDownloaded);
    const etaSeconds = remainingBytes !== null && speedBytesPerSecond > 0 ? remainingBytes / speedBytesPerSecond : null;

    return {
        records: activeRecords,
        count: activeRecords.length,
        downloadingCount: downloadingRecords.length,
        queuedCount: activeRecords.filter((record) => record?.status === 'queued').length,
        pausedCount: activeRecords.filter((record) => record?.status === 'paused').length,
        bytesDownloaded,
        bytesTotal,
        speedBytesPerSecond,
        progress,
        etaSeconds,
        indeterminate: downloadingRecords.length > 0 && bytesTotal === null
    };
};

const getFirstStringValue = (records, field) => {
    return records.reduce((result, record) => result || normalizeGroupValue(record?.[field]), '');
};

const getFirstArrayValue = (records, field) => {
    return records.reduce((result, record) => result.length > 0 ? result : (Array.isArray(record?.[field]) ? record[field] : []), []);
};

const groupDownloadRecordsByMedia = (records) => {
    if (!Array.isArray(records)) {
        return [];
    }

    const mediaByKey = new Map();
    records.forEach((record, index) => {
        if (!record || typeof record !== 'object') {
            return;
        }

        const key = getDownloadMediaKey(record, index);
        const existingGroup = mediaByKey.get(key);
        if (existingGroup) {
            existingGroup.records.push(record);
            existingGroup.latestTimestamp = Math.max(existingGroup.latestTimestamp, getTimestamp(record));
            return;
        }

        mediaByKey.set(key, {
            key,
            type: normalizeGroupValue(record.type).toLowerCase() || null,
            metaId: normalizeGroupValue(record.metaId) || null,
            records: [record],
            latestTimestamp: getTimestamp(record)
        });
    });

    return Array.from(mediaByKey.values()).map((group) => {
        const recordsNewestFirst = sortDownloadRecordsNewestFirst(group.records);
        const type = group.type || getFirstStringValue(recordsNewestFirst, 'type').toLowerCase() || null;
        const recordsForDisplay = sortMediaGroupRecords(group.records, type);
        const statusGroups = groupDownloadRecords(group.records);
        const firstLinkableRecord = recordsNewestFirst.find((record) => getDownloadTitleHref(record) !== null);

        return {
            ...group,
            type,
            title: getFirstStringValue(recordsNewestFirst, 'parentTitle') ||
                getFirstStringValue(recordsNewestFirst, 'videoTitle') ||
                'Untitled download',
            poster: getFirstStringValue(recordsNewestFirst, 'poster') || null,
            background: getFirstStringValue(recordsNewestFirst, 'background') || null,
            logo: getFirstStringValue(recordsNewestFirst, 'logo') || null,
            description: getFirstStringValue(recordsNewestFirst, 'description') || null,
            runtime: getFirstStringValue(recordsNewestFirst, 'runtime') || null,
            releaseInfo: getFirstStringValue(recordsNewestFirst, 'releaseInfo') || null,
            titleReleased: getFirstStringValue(recordsNewestFirst, 'titleReleased') || null,
            metaLinks: getFirstArrayValue(recordsNewestFirst, 'metaLinks'),
            records: recordsForDisplay,
            episodeCount: type === 'series' ? getSeriesEpisodeCount(group.records) : 0,
            activeCount: statusGroups.active.length,
            completedCount: statusGroups.completed.length,
            attentionCount: statusGroups.attention.length,
            latestCompletedRecord: getLatestCompletedRecord(group.records),
            href: firstLinkableRecord ? getDownloadTitleHref(firstLinkableRecord) : null
        };
    }).sort((left, right) => right.latestTimestamp - left.latestTimestamp);
};

const getDownloadRecordStoredArtifact = (record) => {
    const completed = record?.status === 'completed';
    const identity = completed ? record?.localFileIdentity : record?.partialFileIdentity;
    const artifactPath = completed ? record?.localPath : record?.partialPath;
    const identityKey = identity && identity.dev !== undefined && identity.ino !== undefined ? `${identity.dev}:${identity.ino}` : null;
    const fallbackSize = completed ? (record?.bytesTotal ?? record?.bytesDownloaded) : record?.bytesDownloaded;
    const size = Number(identity?.size ?? fallbackSize);
    return {
        key: identityKey || normalizeGroupValue(artifactPath).toLowerCase() || `record:${normalizeGroupValue(record?.id)}`,
        size: Number.isFinite(size) && size >= 0 ? size : null
    };
};

const getDownloadMediaGroupStoredBytes = (group) => {
    const artifacts = new Map();
    (group?.records || []).forEach((record) => {
        const artifact = getDownloadRecordStoredArtifact(record);
        if (!artifact.key || artifact.size === null) {
            return;
        }
        artifacts.set(artifact.key, Math.max(artifacts.get(artifact.key) || 0, artifact.size));
    });
    return Array.from(artifacts.values()).reduce((total, size) => total + size, 0);
};

const getDownloadMediaGroupContentCount = (group) => {
    return group?.type === 'series' ? Number(group.episodeCount) || 0 : Math.max(1, group?.records?.length || 0);
};

const matchesDownloadMediaGroupSearch = (group, query) => {
    const values = [group?.title];
    (group?.records || []).forEach((record) => {
        values.push(record?.videoTitle, ...getEpisodeSearchValues(record));
    });
    return matchesLibrarySearch(values, query);
};

const sortDownloadMediaGroups = (groups, sort = DOWNLOAD_LIBRARY_SORTS.RECENT) => {
    const sorted = [...(groups || [])];
    sorted.sort((left, right) => {
        if (sort === DOWNLOAD_LIBRARY_SORTS.OLDEST) {
            return left.latestTimestamp - right.latestTimestamp || compareLibraryTitles(left, right);
        }
        if (sort === DOWNLOAD_LIBRARY_SORTS.TITLE_ASC) {
            return compareLibraryTitles(left, right);
        }
        if (sort === DOWNLOAD_LIBRARY_SORTS.TITLE_DESC) {
            return compareLibraryTitles(right, left);
        }
        if (sort === DOWNLOAD_LIBRARY_SORTS.SIZE_DESC) {
            return getDownloadMediaGroupStoredBytes(right) - getDownloadMediaGroupStoredBytes(left) || compareLibraryTitles(left, right);
        }
        if (sort === DOWNLOAD_LIBRARY_SORTS.CONTENT_DESC) {
            return getDownloadMediaGroupContentCount(right) - getDownloadMediaGroupContentCount(left) || compareLibraryTitles(left, right);
        }
        return right.latestTimestamp - left.latestTimestamp || compareLibraryTitles(left, right);
    });
    return sorted;
};

const filterAndSortDownloadMediaGroups = (groups, { query = '', sort = DOWNLOAD_LIBRARY_SORTS.RECENT } = {}) => {
    return sortDownloadMediaGroups((groups || []).filter((group) => matchesDownloadMediaGroupSearch(group, query)), sort);
};

const groupDownloadRecords = (records) => {
    const groups = {
        active: [],
        completed: [],
        attention: []
    };

    if (!Array.isArray(records)) {
        return groups;
    }

    records.forEach((record) => {
        if (ACTIVE_DOWNLOAD_STATUSES.has(record?.status)) {
            groups.active.push(record);
        } else if (record?.status === 'completed') {
            groups.completed.push(record);
        } else {
            groups.attention.push(record);
        }
    });

    groups.active = sortActiveDownloadRecords(groups.active);
    groups.completed = sortDownloadRecordsNewestFirst(groups.completed);
    groups.attention = sortDownloadRecordsNewestFirst(groups.attention);
    return groups;
};

const getDownloadTitleHref = (record) => {
    const type = typeof record?.type === 'string' ? record.type.trim() : '';
    const metaId = typeof record?.metaId === 'string' ? record.metaId.trim() : '';
    if (!type || !metaId) {
        return null;
    }

    return `#/metadetails/${encodeURIComponent(type)}/${encodeURIComponent(metaId)}`;
};

const getDownloadDetailsHref = (record) => {
    const baseHref = getDownloadTitleHref(record);
    if (!baseHref) {
        return null;
    }

    const type = typeof record?.type === 'string' ? record.type.trim() : '';
    const videoId = typeof record?.videoId === 'string' ? record.videoId.trim() : '';
    return type === 'series' && videoId ? `${baseHref}/${encodeURIComponent(videoId)}` : baseHref;
};

module.exports = {
    ACTIVE_DOWNLOAD_STATUSES,
    POLLING_DOWNLOAD_STATUSES,
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
    getDownloadDetailsHref,
    DOWNLOAD_LIBRARY_SORTS,
    getDownloadRecordStoredArtifact,
    getDownloadMediaGroupStoredBytes,
    getDownloadMediaGroupContentCount,
    matchesDownloadMediaGroupSearch,
    sortDownloadMediaGroups,
    filterAndSortDownloadMediaGroups
};
