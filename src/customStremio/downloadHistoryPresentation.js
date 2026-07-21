const HISTORY_FILTERS = Object.freeze({
    ALL: 'all',
    COMPLETED: 'completed',
    ATTENTION: 'attention',
    DELETED: 'deleted'
});
const {
    matchesLibrarySearch,
    compareLibraryTitles,
    getEpisodeSearchValues
} = require('./librarySearchSort');

const HISTORY_LIBRARY_SORTS = Object.freeze({
    RECENT: 'recent',
    OLDEST: 'oldest',
    TITLE_ASC: 'title-asc',
    TITLE_DESC: 'title-desc',
    EPISODES_DESC: 'episodes-desc',
    ATTEMPTS_DESC: 'attempts-desc'
});

const ATTENTION_OUTCOMES = new Set(['failed', 'canceled', 'partial']);
const DELETED_OUTCOMES = new Set(['deleted', 'removed']);

const normalizeString = (value) => typeof value === 'string' ? value.trim() : '';

const getEventTimestamp = (event) => {
    const timestamp = Date.parse(event?.occurredAt);
    return Number.isFinite(timestamp) ? timestamp : 0;
};

const getAttemptNumber = (event) => {
    const attemptCount = Number(event?.record?.result?.attemptCount);
    return Number.isSafeInteger(attemptCount) && attemptCount >= 1 ? attemptCount : 1;
};

const getHistoryMediaKey = (event, index = 0) => {
    const media = event?.record?.media;
    const type = normalizeString(media?.type).toLowerCase() || 'unknown';
    const metaId = normalizeString(media?.metaId);
    if (metaId) {
        return `${type}:id:${metaId}`;
    }
    const title = normalizeString(media?.title || media?.videoTitle).toLowerCase();
    if (title) {
        return `${type}:title:${title}`;
    }
    return `download:${normalizeString(event?.downloadId) || index}`;
};

const getHistoryEpisodeKey = (attempt, index = 0) => {
    const media = attempt?.media;
    if (normalizeString(media?.videoId)) {
        return `video:${media.videoId}`;
    }
    if (Number.isSafeInteger(media?.season) && Number.isSafeInteger(media?.episode)) {
        return `episode:${media.season}:${media.episode}`;
    }
    return `attempt:${attempt?.key || index}`;
};

const getAttemptOutcome = (events) => {
    const eventTypes = new Set(events.map(({ eventType }) => eventType));
    if (eventTypes.has('media_deleted')) {
        return 'deleted';
    }
    if (eventTypes.has('record_removed')) {
        return 'removed';
    }

    const latestEvent = [...events].sort((left, right) => getEventTimestamp(right) - getEventTimestamp(left))[0];
    const status = normalizeString(latestEvent?.record?.result?.status).toLowerCase();
    if (['completed', 'failed', 'canceled'].includes(status)) {
        return status;
    }
    if (['queued', 'downloading'].includes(status)) {
        return 'active';
    }
    return 'partial';
};

const getFirstValue = (items, selector) => items.reduce((result, item) => result || selector(item), null);

const createHistoryAttempt = (downloadId, attemptNumber, events, currentAttemptNumber) => {
    const sortedEvents = [...events].sort((left, right) => getEventTimestamp(right) - getEventTimestamp(left));
    const latestEvent = sortedEvents[0];
    const record = latestEvent?.record || {};
    return {
        key: `${downloadId}:attempt:${attemptNumber}`,
        downloadId,
        attemptNumber,
        media: record.media || {},
        source: record.source || {},
        result: record.result || {},
        outcome: getAttemptOutcome(sortedEvents),
        current: currentAttemptNumber === attemptNumber,
        latestAt: latestEvent?.occurredAt || null,
        latestTimestamp: getEventTimestamp(latestEvent),
        events: sortedEvents
    };
};

const projectDownloadHistory = (events, currentRecords = []) => {
    if (!Array.isArray(events)) {
        return [];
    }

    const currentAttempts = new Map((currentRecords || []).filter((record) => normalizeString(record?.id)).map((record) => {
        const attemptCount = Number(record?.attemptCount);
        return [String(record.id), Number.isSafeInteger(attemptCount) && attemptCount >= 1 ? attemptCount : 1];
    }));
    const attemptsByKey = new Map();
    events.forEach((event) => {
        const downloadId = normalizeString(event?.downloadId);
        if (!downloadId || !normalizeString(event?.eventType) || !event?.record?.media || !event?.record?.result) {
            return;
        }
        const attemptNumber = getAttemptNumber(event);
        const key = `${downloadId}:attempt:${attemptNumber}`;
        const attemptEvents = attemptsByKey.get(key) || { downloadId, attemptNumber, events: [] };
        attemptEvents.events.push(event);
        attemptsByKey.set(key, attemptEvents);
    });

    const mediaByKey = new Map();
    Array.from(attemptsByKey.values()).forEach(({ downloadId, attemptNumber, events: attemptEvents }, index) => {
        const attempt = createHistoryAttempt(downloadId, attemptNumber, attemptEvents, currentAttempts.get(downloadId));
        const mediaKey = getHistoryMediaKey(attempt.events[0], index);
        const group = mediaByKey.get(mediaKey) || { key: mediaKey, attempts: [] };
        group.attempts.push(attempt);
        mediaByKey.set(mediaKey, group);
    });

    return Array.from(mediaByKey.values()).map((group) => {
        const attempts = group.attempts.sort((left, right) => right.latestTimestamp - left.latestTimestamp);
        const newestMedia = attempts[0]?.media || {};
        const episodeKeys = new Set(attempts.map(getHistoryEpisodeKey));
        return {
            ...group,
            type: normalizeString(newestMedia.type).toLowerCase() || null,
            metaId: normalizeString(newestMedia.metaId) || null,
            title: getFirstValue(attempts, ({ media }) => normalizeString(media.title || media.videoTitle)) || 'Untitled history',
            poster: getFirstValue(attempts, ({ media }) => normalizeString(media.poster)) || null,
            attempts,
            latestAt: attempts[0]?.latestAt || null,
            latestTimestamp: attempts[0]?.latestTimestamp || 0,
            latestOutcome: attempts[0]?.outcome || 'partial',
            attemptCount: attempts.length,
            episodeCount: normalizeString(newestMedia.type).toLowerCase() === 'series' ? episodeKeys.size : 0,
            completedCount: attempts.filter(({ outcome }) => outcome === 'completed').length,
            attentionCount: attempts.filter(({ outcome }) => ATTENTION_OUTCOMES.has(outcome)).length,
            deletedCount: attempts.filter(({ outcome }) => DELETED_OUTCOMES.has(outcome)).length,
            currentCount: attempts.filter(({ current }) => current).length
        };
    }).sort((left, right) => right.latestTimestamp - left.latestTimestamp);
};

const attemptMatchesFilter = (attempt, filter) => {
    if (filter === HISTORY_FILTERS.COMPLETED) {
        return attempt.outcome === 'completed';
    }
    if (filter === HISTORY_FILTERS.ATTENTION) {
        return ATTENTION_OUTCOMES.has(attempt.outcome);
    }
    if (filter === HISTORY_FILTERS.DELETED) {
        return DELETED_OUTCOMES.has(attempt.outcome);
    }
    return true;
};

const filterDownloadHistoryGroups = (groups, filter) => {
    if (!Array.isArray(groups)) {
        return [];
    }
    return filter === HISTORY_FILTERS.ALL ? groups : groups.filter((group) => group.attempts.some((attempt) => attemptMatchesFilter(attempt, filter)));
};

const matchesDownloadHistoryGroupSearch = (group, query) => {
    const values = [group?.title];
    (group?.attempts || []).forEach((attempt) => {
        values.push(attempt?.media?.videoTitle, ...getEpisodeSearchValues(attempt?.media));
    });
    return matchesLibrarySearch(values, query);
};

const sortDownloadHistoryGroups = (groups, sort = HISTORY_LIBRARY_SORTS.RECENT) => {
    const sorted = [...(groups || [])];
    sorted.sort((left, right) => {
        if (sort === HISTORY_LIBRARY_SORTS.OLDEST) {
            return left.latestTimestamp - right.latestTimestamp || compareLibraryTitles(left, right);
        }
        if (sort === HISTORY_LIBRARY_SORTS.TITLE_ASC) {
            return compareLibraryTitles(left, right);
        }
        if (sort === HISTORY_LIBRARY_SORTS.TITLE_DESC) {
            return compareLibraryTitles(right, left);
        }
        if (sort === HISTORY_LIBRARY_SORTS.EPISODES_DESC) {
            return right.episodeCount - left.episodeCount || compareLibraryTitles(left, right);
        }
        if (sort === HISTORY_LIBRARY_SORTS.ATTEMPTS_DESC) {
            return right.attemptCount - left.attemptCount || compareLibraryTitles(left, right);
        }
        return right.latestTimestamp - left.latestTimestamp || compareLibraryTitles(left, right);
    });
    return sorted;
};

const filterAndSortDownloadHistoryGroups = (groups, {
    filter = HISTORY_FILTERS.ALL,
    query = '',
    sort = HISTORY_LIBRARY_SORTS.RECENT
} = {}) => {
    const outcomeGroups = filterDownloadHistoryGroups(groups, filter);
    return sortDownloadHistoryGroups(outcomeGroups.filter((group) => matchesDownloadHistoryGroupSearch(group, query)), sort);
};

const getDownloadHistoryFilterCounts = (groups) => ({
    [HISTORY_FILTERS.ALL]: groups.length,
    [HISTORY_FILTERS.COMPLETED]: groups.filter((group) => group.attempts.some((attempt) => attemptMatchesFilter(attempt, HISTORY_FILTERS.COMPLETED))).length,
    [HISTORY_FILTERS.ATTENTION]: groups.filter((group) => group.attempts.some((attempt) => attemptMatchesFilter(attempt, HISTORY_FILTERS.ATTENTION))).length,
    [HISTORY_FILTERS.DELETED]: groups.filter((group) => group.attempts.some((attempt) => attemptMatchesFilter(attempt, HISTORY_FILTERS.DELETED))).length
});

const groupHistoryAttemptsBySeason = (attempts) => {
    const episodesByKey = new Map();
    attempts.forEach((attempt, index) => {
        const episodeKey = getHistoryEpisodeKey(attempt, index);
        const episode = episodesByKey.get(episodeKey) || {
            key: episodeKey,
            season: Number.isSafeInteger(attempt.media?.season) ? attempt.media.season : null,
            episode: Number.isSafeInteger(attempt.media?.episode) ? attempt.media.episode : null,
            title: normalizeString(attempt.media?.videoTitle) || 'Untitled episode',
            attempts: []
        };
        episode.attempts.push(attempt);
        episodesByKey.set(episodeKey, episode);
    });

    const seasonsByKey = new Map();
    Array.from(episodesByKey.values()).sort((left, right) => {
        const leftSeason = left.season ?? Number.MAX_SAFE_INTEGER;
        const rightSeason = right.season ?? Number.MAX_SAFE_INTEGER;
        const leftEpisode = left.episode ?? Number.MAX_SAFE_INTEGER;
        const rightEpisode = right.episode ?? Number.MAX_SAFE_INTEGER;
        return leftSeason - rightSeason || leftEpisode - rightEpisode;
    }).forEach((episode) => {
        const key = episode.season === null ? 'season:unknown' : `season:${episode.season}`;
        const season = seasonsByKey.get(key) || { key, season: episode.season, episodes: [] };
        season.episodes.push(episode);
        seasonsByKey.set(key, season);
    });
    return Array.from(seasonsByKey.values());
};

module.exports = {
    HISTORY_FILTERS,
    ATTENTION_OUTCOMES,
    DELETED_OUTCOMES,
    getEventTimestamp,
    getAttemptNumber,
    getHistoryMediaKey,
    getHistoryEpisodeKey,
    getAttemptOutcome,
    projectDownloadHistory,
    attemptMatchesFilter,
    filterDownloadHistoryGroups,
    getDownloadHistoryFilterCounts,
    groupHistoryAttemptsBySeason,
    HISTORY_LIBRARY_SORTS,
    matchesDownloadHistoryGroupSearch,
    sortDownloadHistoryGroups,
    filterAndSortDownloadHistoryGroups
};
