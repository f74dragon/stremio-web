const ACTIVE_DOWNLOAD_STATUSES = new Set(['queued', 'downloading', 'paused']);

const getTimestamp = (record) => {
    const value = record?.completedAt || record?.updatedAt || record?.createdAt;
    const timestamp = value ? new Date(value).getTime() : 0;
    return Number.isFinite(timestamp) ? timestamp : 0;
};

const sortDownloadRecordsNewestFirst = (records) => {
    return [...records].sort((left, right) => getTimestamp(right) - getTimestamp(left));
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

    groups.active = sortDownloadRecordsNewestFirst(groups.active);
    groups.completed = sortDownloadRecordsNewestFirst(groups.completed);
    groups.attention = sortDownloadRecordsNewestFirst(groups.attention);
    return groups;
};

const getDownloadDetailsHref = (record) => {
    const type = typeof record?.type === 'string' ? record.type.trim() : '';
    const metaId = typeof record?.metaId === 'string' ? record.metaId.trim() : '';
    if (!type || !metaId) {
        return null;
    }

    const baseHref = `#/metadetails/${encodeURIComponent(type)}/${encodeURIComponent(metaId)}`;
    const videoId = typeof record?.videoId === 'string' ? record.videoId.trim() : '';
    return type === 'series' && videoId ? `${baseHref}/${encodeURIComponent(videoId)}` : baseHref;
};

module.exports = {
    ACTIVE_DOWNLOAD_STATUSES,
    sortDownloadRecordsNewestFirst,
    groupDownloadRecords,
    getDownloadDetailsHref
};
