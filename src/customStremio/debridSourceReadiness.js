const SOURCE_READINESS = Object.freeze({
    CACHED: 'cached',
    PREVIOUSLY_CACHED: 'previously_cached',
    REQUIRES_CACHING: 'requires_caching',
    UNKNOWN: 'unknown'
});

const INFO_HASH_PATTERN = /^[a-f0-9]{40}$/i;
const INFO_HASH_IN_TEXT_PATTERN = /(?:^|[^a-f0-9])([a-f0-9]{40})(?=$|[^a-f0-9])/ig;

const normalizeInfoHash = (value) => {
    const hash = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return INFO_HASH_PATTERN.test(hash) ? hash : null;
};

const extractInfoHashFromValue = (value) => {
    const directHash = normalizeInfoHash(value);
    if (directHash) {
        return directHash;
    }
    if (typeof value !== 'string') {
        return null;
    }

    const hashes = new Set();
    let match;
    INFO_HASH_IN_TEXT_PATTERN.lastIndex = 0;
    while ((match = INFO_HASH_IN_TEXT_PATTERN.exec(value)) !== null) {
        hashes.add(match[1].toLowerCase());
    }
    return hashes.size === 1 ? Array.from(hashes)[0] : null;
};

const getStreamInfoHash = (stream) => {
    const candidates = [
        stream?.infoHash,
        stream?.deepLinks?.externalPlayer?.download,
        stream?.deepLinks?.externalPlayer?.streaming,
        stream?.deepLinks?.externalPlayer?.magnet,
        stream?.url,
        stream?.externalUrl
    ];
    for (const candidate of candidates) {
        const hash = extractInfoHashFromValue(candidate);
        if (hash) {
            return hash;
        }
    }
    return null;
};

const ALLDEBRID_CACHED_MARKER = /(?:^|[^a-z0-9])ad\s*\+(?:$|[^a-z0-9])/i;
const classifyDebridSourceReadiness = (stream, availability = null) => {
    if (availability?.status === 'cached') {
        return availability.previouslyVerified === true ? SOURCE_READINESS.PREVIOUSLY_CACHED : SOURCE_READINESS.CACHED;
    }
    if (availability?.status === 'uncached') {
        return SOURCE_READINESS.REQUIRES_CACHING;
    }

    const searchableText = [stream?.name, stream?.description]
        .filter((value) => typeof value === 'string')
        .join('\n');

    if (ALLDEBRID_CACHED_MARKER.test(searchableText)) {
        return SOURCE_READINESS.CACHED;
    }

    return SOURCE_READINESS.UNKNOWN;
};

const getSourceReadinessSortRank = (readiness) => {
    switch (readiness) {
        case SOURCE_READINESS.CACHED:
            return 0;
        case SOURCE_READINESS.PREVIOUSLY_CACHED:
            return 1;
        case SOURCE_READINESS.REQUIRES_CACHING:
            return 3;
        default:
            return 2;
    }
};

module.exports = {
    SOURCE_READINESS,
    normalizeInfoHash,
    extractInfoHashFromValue,
    getStreamInfoHash,
    classifyDebridSourceReadiness,
    getSourceReadinessSortRank
};
