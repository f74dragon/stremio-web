const SOURCE_READINESS = Object.freeze({
    CACHED: 'cached',
    PREVIOUSLY_CACHED: 'previously_cached',
    REQUIRES_CACHING: 'requires_caching',
    UNAVAILABLE: 'unavailable',
    UNKNOWN: 'unknown'
});

const DEBRID_PROVIDER = Object.freeze({
    ALLDEBRID: 'alldebrid',
    REALDEBRID: 'realdebrid',
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
    const candidates = [value];
    try {
        const decoded = decodeURIComponent(value);
        if (decoded !== value) {
            candidates.push(decoded);
        }
    } catch {
        // Keep the original URL/text when percent decoding is malformed.
    }
    for (const candidate of candidates) {
        let match;
        INFO_HASH_IN_TEXT_PATTERN.lastIndex = 0;
        while ((match = INFO_HASH_IN_TEXT_PATTERN.exec(candidate)) !== null) {
            hashes.add(match[1].toLowerCase());
        }
    }
    return hashes.size === 1 ? Array.from(hashes)[0] : null;
};

const getStreamLinkValues = (stream) => [
    stream?.url,
    stream?.externalUrl,
    stream?.downloadUrl,
    stream?.streamingUrl,
    stream?.deepLinks?.player,
    stream?.deepLinks?.externalPlayer?.download,
    stream?.deepLinks?.externalPlayer?.streaming,
    stream?.deepLinks?.externalPlayer?.magnet,
    stream?.deepLinks?.externalPlayer?.playlist,
    stream?.deepLinks?.externalPlayer?.web,
    ...Object.values(stream?.deepLinks?.externalPlayer?.openPlayer || {})
].filter((value) => typeof value === 'string');

const getStreamInfoHash = (stream) => {
    const candidates = [
        stream?.infoHash,
        ...getStreamLinkValues(stream)
    ];
    for (const candidate of candidates) {
        const hash = extractInfoHashFromValue(candidate);
        if (hash) {
            return hash;
        }
    }
    return null;
};

const normalizeAvailabilityFilename = (value) => typeof value === 'string' ? value.trim().replace(/\\/g, '/').toLowerCase() : '';

const createRealDebridSourceKey = ({ hash, fileIdx = null, filename = null, videoSize = null }) => [
    hash,
    fileIdx === null ? '' : String(fileIdx),
    encodeURIComponent(normalizeAvailabilityFilename(filename)),
    videoSize === null ? '' : String(videoSize)
].join('::');

const getRealDebridSourceDescriptor = (stream) => {
    const hash = getStreamInfoHash(stream);
    if (!hash) {
        return null;
    }
    const descriptor = {
        hash,
        fileIdx: Number.isSafeInteger(stream?.fileIdx) && stream.fileIdx >= 0 ? stream.fileIdx : null,
        filename: stream?.behaviorHints?.filename || stream?.deepLinks?.externalPlayer?.fileName || null,
        videoSize: Number.isSafeInteger(stream?.behaviorHints?.videoSize) && stream.behaviorHints.videoSize > 0 ?
            stream.behaviorHints.videoSize
            : null
    };
    return { ...descriptor, key: createRealDebridSourceKey(descriptor) };
};

const getRealDebridAvailabilitySortRank = (availability) => {
    if (availability?.status === 'cached') {
        return availability.previouslyVerified === true ? 1 : 0;
    }
    if (availability?.status === 'uncached') {
        return 3;
    }
    if (availability?.status === 'unavailable') {
        return 4;
    }
    return 2;
};

const ALLDEBRID_ADDON_MARKER = /(?:all[\s._-]*debrid|(?:^|[\s([_-])ad(?:$|[\s)\]_-]))/i;
const REALDEBRID_ADDON_MARKER = /(?:real[\s._-]*debrid|(?:^|[\s([_-])rd(?:$|[\s)\]_-]))/i;
const ALLDEBRID_STREAM_PROVIDER_MARKER = /(?:^|[^a-z0-9])(?:ad\s*(?:\+|download)|\[\s*ad\s*\]|all[\s._-]*debrid)(?:$|[^a-z0-9])/i;
const REALDEBRID_STREAM_PROVIDER_MARKER = /(?:^|[^a-z0-9])(?:rd\s*(?:\+|download)|\[\s*rd\s*\]|real[\s._-]*debrid)(?:$|[^a-z0-9])/i;

const detectProviderInText = (text, allDebridPattern, realDebridPattern) => {
    const allDebrid = allDebridPattern.test(text);
    const realDebrid = realDebridPattern.test(text);
    if (allDebrid === realDebrid) {
        return DEBRID_PROVIDER.UNKNOWN;
    }
    return allDebrid ? DEBRID_PROVIDER.ALLDEBRID : DEBRID_PROVIDER.REALDEBRID;
};

const getDebridProvider = (stream) => {
    if ([DEBRID_PROVIDER.ALLDEBRID, DEBRID_PROVIDER.REALDEBRID].includes(stream?.debridProvider)) {
        return stream.debridProvider;
    }

    const streamText = [stream?.name, stream?.title, stream?.description]
        .filter((value) => typeof value === 'string')
        .join('\n');
    const streamProvider = detectProviderInText(
        streamText,
        ALLDEBRID_STREAM_PROVIDER_MARKER,
        REALDEBRID_STREAM_PROVIDER_MARKER
    );
    if (streamProvider !== DEBRID_PROVIDER.UNKNOWN) {
        return streamProvider;
    }

    const linkProvider = detectProviderInText(
        getStreamLinkValues(stream).join('\n'),
        /all[\s._=-]*debrid/i,
        /real[\s._=-]*debrid/i
    );
    if (linkProvider !== DEBRID_PROVIDER.UNKNOWN) {
        return linkProvider;
    }

    const addonText = [stream?.addonName, stream?.addonId, stream?.addonDescription, stream?.addonTransportUrl]
        .filter((value) => typeof value === 'string')
        .join('\n');
    return detectProviderInText(addonText, ALLDEBRID_ADDON_MARKER, REALDEBRID_ADDON_MARKER);
};

const classifyDebridSourceReadiness = (stream, availability = null) => {
    if (availability?.status === 'cached') {
        return availability.previouslyVerified === true ? SOURCE_READINESS.PREVIOUSLY_CACHED : SOURCE_READINESS.CACHED;
    }
    if (availability?.status === 'uncached') {
        return SOURCE_READINESS.REQUIRES_CACHING;
    }
    if (availability?.status === 'unavailable') {
        return SOURCE_READINESS.UNAVAILABLE;
    }

    return SOURCE_READINESS.UNKNOWN;
};

const classifyRealDebridSourceReadiness = (stream, availability = null) => {
    if (availability?.status === 'cached') {
        return availability.previouslyVerified === true ? SOURCE_READINESS.PREVIOUSLY_CACHED : SOURCE_READINESS.CACHED;
    }
    if (availability?.status === 'uncached') {
        return SOURCE_READINESS.REQUIRES_CACHING;
    }
    if (availability?.status === 'unavailable') {
        return SOURCE_READINESS.UNAVAILABLE;
    }
    return SOURCE_READINESS.UNKNOWN;
};

const classifyProviderSourceReadiness = (stream, { allDebridAvailability = null, realDebridAvailability = null } = {}) => {
    switch (getDebridProvider(stream)) {
        case DEBRID_PROVIDER.ALLDEBRID:
            return classifyDebridSourceReadiness(stream, allDebridAvailability);
        case DEBRID_PROVIDER.REALDEBRID:
            return classifyRealDebridSourceReadiness(stream, realDebridAvailability);
        default:
            return SOURCE_READINESS.UNKNOWN;
    }
};

const isSourceReadinessBlocked = (readiness) => [
    SOURCE_READINESS.REQUIRES_CACHING,
    SOURCE_READINESS.UNAVAILABLE
].includes(readiness);

const getSourceReadinessSortRank = (readiness) => {
    switch (readiness) {
        case SOURCE_READINESS.CACHED:
            return 0;
        case SOURCE_READINESS.PREVIOUSLY_CACHED:
            return 1;
        case SOURCE_READINESS.REQUIRES_CACHING:
            return 3;
        case SOURCE_READINESS.UNAVAILABLE:
            return 4;
        default:
            return 2;
    }
};

module.exports = {
    SOURCE_READINESS,
    DEBRID_PROVIDER,
    normalizeInfoHash,
    extractInfoHashFromValue,
    getStreamInfoHash,
    createRealDebridSourceKey,
    getRealDebridSourceDescriptor,
    getRealDebridAvailabilitySortRank,
    getDebridProvider,
    classifyDebridSourceReadiness,
    classifyRealDebridSourceReadiness,
    classifyProviderSourceReadiness,
    isSourceReadinessBlocked,
    getSourceReadinessSortRank
};
