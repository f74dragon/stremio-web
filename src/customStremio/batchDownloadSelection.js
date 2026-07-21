const { DEBRID_PROVIDER, SOURCE_READINESS } = require('./debridSourceReadiness');

const BATCH_PROVIDER_POLICY = Object.freeze({
    EITHER: 'either',
    ALLDEBRID: DEBRID_PROVIDER.ALLDEBRID,
    REALDEBRID: DEBRID_PROVIDER.REALDEBRID
});

const SAFE_BATCH_READINESS = new Set([
    SOURCE_READINESS.CACHED,
    SOURCE_READINESS.READY,
    SOURCE_READINESS.PREVIOUSLY_CACHED
]);
const BATCH_DOWNLOAD_SESSION_STORAGE_KEY = 'customStremio.batchDownloadSession';

const normalizeText = (value) => typeof value === 'string' ? value.trim() : '';

const getBatchSourceText = (candidate) => [
    candidate?.name,
    candidate?.description,
    candidate?.stream?.title,
    candidate?.payload?.streamName,
    candidate?.payload?.streamDescription,
    candidate?.payload?.fileName,
    candidate?.payload?.behaviorHints?.filename
].map(normalizeText).filter(Boolean).join(' ');

const getBatchSourceQualityLabel = (candidate) => {
    const text = getBatchSourceText(candidate);
    const is4k = /(?:\b2160[pi]?\b|\b4k\b|\buhd\b)/i.test(text);
    const hasDolbyVision = /(?:\bdolby[ ._-]*vision\b|\bdovi\b|\bdv\b)/i.test(text);
    const hasHdr10Plus = /\bhdr10(?:\+|[ ._-]*plus)/i.test(text);
    const hasHdr10 = /\bhdr10\b/i.test(text);
    const hasHdr = /\bhdr\b/i.test(text);
    if (is4k) {
        const formats = [
            hasDolbyVision ? 'Dolby Vision' : null,
            hasHdr10Plus ? 'HDR10+' : hasHdr10 ? 'HDR10' : hasHdr ? 'HDR' : null
        ].filter(Boolean);
        return formats.length > 0 ? `4K ${formats.join(' / ')}` : '4K';
    }
    const resolution = Array.from(text.matchAll(/\b(2160|1440|1080|720|576|540|480|360|240)[pi]?\b/ig))
        .map((match) => Number(match[1]))
        .filter((value) => Number.isFinite(value) && value >= 240 && value <= 2160)
        .sort((left, right) => right - left)[0];
    return resolution ? `${resolution}p` : 'Quality unknown';
};

const getBatchSourceQualityRank = (candidate) => {
    const text = getBatchSourceText(candidate);
    const is4k = /(?:\b2160[pi]?\b|\b4k\b|\buhd\b)/i.test(text);
    const hasPremiumHdr = /(?:\bdolby[ ._-]*vision\b|\bdovi\b|\bdv\b|\bhdr(?:10(?:\+|plus)?)?\b)/i.test(text);
    if (is4k && hasPremiumHdr) {
        return 0;
    }
    if (is4k) {
        return 1;
    }
    if (/\b1080[pi]?\b/i.test(text)) {
        return 2;
    }
    if (/\b720[pi]?\b/i.test(text)) {
        return 3;
    }
    const resolution = Array.from(text.matchAll(/\b(\d{3,4})p\b/ig))
        .map((match) => Number(match[1]))
        .filter(Number.isFinite)
        .sort((left, right) => right - left)[0];
    return resolution ? 10000 - resolution : Number.MAX_SAFE_INTEGER;
};

const getBatchSourceSize = (candidate) => {
    const values = [
        candidate?.size,
        candidate?.payload?.behaviorHints?.videoSize
    ];
    const size = values.map(Number).find((value) => Number.isFinite(value) && value > 0);
    return size || 0;
};

const getBatchSourceKey = (candidate) => {
    const payload = candidate?.payload || {};
    return [
        candidate?.provider || payload.debridProvider || DEBRID_PROVIDER.UNKNOWN,
        payload.infoHash,
        payload.fileIdx,
        payload.behaviorHints?.filename,
        payload.behaviorHints?.videoSize,
        payload.downloadUrl,
        payload.streamUrl,
        candidate?.name
    ].map((value) => normalizeText(value === null || value === undefined ? '' : String(value))).join('|');
};

const isCandidateAllowedByProvider = (candidate, providerPolicy) => providerPolicy === BATCH_PROVIDER_POLICY.EITHER ||
    candidate?.provider === providerPolicy;

const compareBatchSourcePriority = (left, right) => getBatchSourceQualityRank(left) - getBatchSourceQualityRank(right) ||
    getBatchSourceSize(right) - getBatchSourceSize(left);

const sortBatchSourceCandidates = (candidates, { providerPolicy = BATCH_PROVIDER_POLICY.EITHER } = {}) => (candidates || [])
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => SAFE_BATCH_READINESS.has(candidate?.readiness) && isCandidateAllowedByProvider(candidate, providerPolicy))
    .sort((left, right) => compareBatchSourcePriority(left.candidate, right.candidate) || left.index - right.index)
    .map(({ candidate }) => candidate);

const selectRecommendedBatchSource = (candidates, options) => sortBatchSourceCandidates(candidates, options)[0] || null;
const hasHigherPriorityUnverifiedBatchSource = (candidates, recommended, { providerPolicy = BATCH_PROVIDER_POLICY.EITHER } = {}) =>
    Boolean(recommended) && (candidates || []).some((candidate) => candidate?.readiness === SOURCE_READINESS.UNKNOWN &&
        [DEBRID_PROVIDER.ALLDEBRID, DEBRID_PROVIDER.REALDEBRID].includes(candidate?.provider) &&
        isCandidateAllowedByProvider(candidate, providerPolicy) &&
        compareBatchSourcePriority(candidate, recommended) < 0);
const sortBatchAutoVerificationCandidates = (candidates, { providerPolicy = BATCH_PROVIDER_POLICY.EITHER } = {}) => (candidates || [])
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => isCandidateAllowedByProvider(candidate, providerPolicy) && (
        SAFE_BATCH_READINESS.has(candidate?.readiness) ||
        candidate?.readiness === SOURCE_READINESS.UNKNOWN &&
        [DEBRID_PROVIDER.ALLDEBRID, DEBRID_PROVIDER.REALDEBRID].includes(candidate?.provider)
    ))
    .sort((left, right) => compareBatchSourcePriority(left.candidate, right.candidate) || left.index - right.index)
    .map(({ candidate }) => candidate);
const selectNextBatchAutoVerificationCandidate = (candidates, attemptedSourceKeys, options) => {
    const attempts = attemptedSourceKeys instanceof Set ? attemptedSourceKeys : new Set(attemptedSourceKeys || []);
    return sortBatchAutoVerificationCandidates(candidates, options).find((candidate) =>
        SAFE_BATCH_READINESS.has(candidate?.readiness) || !attempts.has(getBatchSourceKey(candidate))
    ) || null;
};

const createBatchDownloadSession = ({ metaId, parentTitle, episodes, providerPolicy = BATCH_PROVIDER_POLICY.EITHER }) => ({
    version: 1,
    metaId: normalizeText(metaId),
    parentTitle: normalizeText(parentTitle),
    providerPolicy: Object.values(BATCH_PROVIDER_POLICY).includes(providerPolicy) ? providerPolicy : BATCH_PROVIDER_POLICY.EITHER,
    episodes: (episodes || []).filter((episode) => normalizeText(episode?.id) && normalizeText(episode?.href)).map((episode) => ({
        id: normalizeText(episode.id),
        title: normalizeText(episode.title) || normalizeText(episode.id),
        season: Number.isSafeInteger(episode.season) ? episode.season : null,
        episode: Number.isSafeInteger(episode.episode) ? episode.episode : null,
        thumbnail: normalizeText(episode.thumbnail) || null,
        href: normalizeText(episode.href)
    })),
    assignments: {},
    automaticSelection: true,
    manualSelectionEpisodeIds: [],
    verificationAttempts: {},
    status: 'collecting'
});

const assignBatchDownloadSource = (session, videoId, candidate) => {
    if (!session || !session.episodes.some((episode) => episode.id === videoId) || !candidate?.payload) {
        return session;
    }
    const assignments = {
        ...session.assignments,
        [videoId]: {
            payload: candidate.payload,
            provider: candidate.provider || DEBRID_PROVIDER.UNKNOWN,
            readiness: candidate.readiness || SOURCE_READINESS.UNKNOWN,
            addonName: candidate.addonName || candidate.payload.addonName || null,
            sourceName: candidate.name || candidate.payload.streamName || candidate.payload.fileName || 'Selected source',
            qualityLabel: getBatchSourceQualityLabel(candidate),
            qualityRank: getBatchSourceQualityRank(candidate),
            size: getBatchSourceSize(candidate)
        }
    };
    return {
        ...session,
        assignments,
        status: session.episodes.every((episode) => Boolean(assignments[episode.id])) ? 'review' : 'collecting'
    };
};

const removeBatchDownloadAssignment = (session, videoId) => session ? {
    ...session,
    assignments: Object.fromEntries(Object.entries(session.assignments || {}).filter(([id]) => id !== videoId)),
    manualSelectionEpisodeIds: Array.from(new Set([...(session.manualSelectionEpisodeIds || []), videoId])),
    status: 'collecting'
} : session;

const markBatchDownloadAssignmentSubmitted = (session, videoId, record) => {
    const assignment = session?.assignments?.[videoId];
    if (!assignment) {
        return session;
    }
    return {
        ...session,
        assignments: {
            ...session.assignments,
            [videoId]: {
                ...assignment,
                submitted: true,
                recordId: normalizeText(record?.id) || null
            }
        }
    };
};

const markBatchVerificationAttempt = (session, videoId, candidate) => {
    if (!session || !session.episodes.some((episode) => episode.id === videoId)) {
        return session;
    }
    const sourceKey = getBatchSourceKey(candidate);
    const attempts = new Set(session.verificationAttempts?.[videoId] || []);
    attempts.add(sourceKey);
    return {
        ...session,
        verificationAttempts: {
            ...session.verificationAttempts,
            [videoId]: Array.from(attempts)
        }
    };
};

const getBatchVerificationAttempts = (session, videoId) => new Set(session?.verificationAttempts?.[videoId] || []);

const getNextUnassignedBatchEpisode = (session) => session?.episodes?.find((episode) => !session.assignments?.[episode.id]) || null;

const getBatchDownloadAssignments = (session) => (session?.episodes || [])
    .map((episode) => ({ episode, assignment: session.assignments?.[episode.id] || null }))
    .filter(({ assignment }) => assignment !== null);

const readBatchDownloadSession = (storage, metaId) => {
    if (!storage || typeof storage.getItem !== 'function') {
        return null;
    }
    try {
        const session = JSON.parse(storage.getItem(BATCH_DOWNLOAD_SESSION_STORAGE_KEY));
        return session?.version === 1 && session.metaId === normalizeText(metaId) &&
            Array.isArray(session.episodes) && session.episodes.length > 0 && session.assignments && typeof session.assignments === 'object' ?
            session
            : null;
    } catch {
        return null;
    }
};

const writeBatchDownloadSession = (storage, session) => {
    if (!storage || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') {
        return false;
    }
    try {
        if (session) {
            storage.setItem(BATCH_DOWNLOAD_SESSION_STORAGE_KEY, JSON.stringify(session));
        } else {
            storage.removeItem(BATCH_DOWNLOAD_SESSION_STORAGE_KEY);
        }
        return true;
    } catch {
        return false;
    }
};

module.exports = {
    BATCH_PROVIDER_POLICY,
    SAFE_BATCH_READINESS,
    BATCH_DOWNLOAD_SESSION_STORAGE_KEY,
    getBatchSourceText,
    getBatchSourceQualityLabel,
    getBatchSourceQualityRank,
    getBatchSourceSize,
    getBatchSourceKey,
    sortBatchSourceCandidates,
    selectRecommendedBatchSource,
    hasHigherPriorityUnverifiedBatchSource,
    sortBatchAutoVerificationCandidates,
    selectNextBatchAutoVerificationCandidate,
    createBatchDownloadSession,
    assignBatchDownloadSource,
    removeBatchDownloadAssignment,
    markBatchDownloadAssignmentSubmitted,
    markBatchVerificationAttempt,
    getBatchVerificationAttempts,
    getNextUnassignedBatchEpisode,
    getBatchDownloadAssignments,
    readBatchDownloadSession,
    writeBatchDownloadSession
};
