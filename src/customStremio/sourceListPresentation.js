const { SOURCE_READINESS, getSourceReadinessSortRank } = require('./debridSourceReadiness');
const { parseStreamVideoSize } = require('./downloadPayload');

const normalizeText = (value) => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const getSourceText = (stream) => [
    stream?.name, stream?.title, stream?.description, stream?.addonName,
    stream?.behaviorHints?.filename, stream?.deepLinks?.externalPlayer?.fileName,
    stream?.infoHash, stream?.debridProvider
].filter((value) => typeof value === 'string').join(' ');

const getSourceResolution = (text) => {
    if (/\b(?:8k|4320[pi]?)\b/i.test(text)) {
        return 4320;
    }
    if (/\b(?:4k|uhd|2160[pi]?)\b/i.test(text)) {
        return 2160;
    }
    return Math.max(0, ...Array.from(text.matchAll(/\b(1440|1080|720|576|540|480|360|240)[pi]?\b/ig), (match) => Number(match[1])));
};

const matchesAvailability = (readiness, filter) => {
    switch (filter) {
        case 'available':
            return [SOURCE_READINESS.CACHED, SOURCE_READINESS.READY, SOURCE_READINESS.PREVIOUSLY_CACHED].includes(readiness);
        case 'unchecked':
            return readiness === SOURCE_READINESS.UNKNOWN;
        case 'uncached':
            return readiness === SOURCE_READINESS.REQUIRES_CACHING;
        case 'unavailable':
            return readiness === SOURCE_READINESS.UNAVAILABLE;
        default:
            return true;
    }
};

const filterAndSortSources = (streams, {
    search = '', availability = 'all', sort = 'recommended', preferredAddon = '',
    getReadiness = () => SOURCE_READINESS.UNKNOWN
} = {}) => {
    const tokens = normalizeText(search).trim().split(/\s+/).filter(Boolean);
    const preferred = normalizeText(preferredAddon).trim();
    return streams.map((stream, index) => {
        const text = getSourceText(stream);
        return {
            stream, index, text: normalizeText(text), readiness: getReadiness(stream),
            resolution: sort === 'quality' ? getSourceResolution(text) : 0,
            size: ['size-desc', 'size-asc'].includes(sort) ? parseStreamVideoSize(stream) : null
        };
    }).filter((item) => tokens.every((token) => item.text.includes(token)) && matchesAvailability(item.readiness, availability))
        .sort((left, right) => {
            let difference = 0;
            switch (sort) {
                case 'quality':
                    difference = right.resolution - left.resolution;
                    break;
                case 'size-desc':
                case 'size-asc':
                    // Unknown sizes stay last in either direction.
                    difference = !left.size || !right.size ? Number(!left.size) - Number(!right.size) :
                        sort === 'size-desc' ? right.size - left.size : left.size - right.size;
                    break;
                case 'name':
                    difference = normalizeText(left.stream.name || left.stream.title).localeCompare(
                        normalizeText(right.stream.name || right.stream.title), undefined, { numeric: true });
                    break;
                default:
                    difference = preferred ?
                        Number(normalizeText(right.stream.addonName).trim() === preferred) -
                        Number(normalizeText(left.stream.addonName).trim() === preferred) : 0;
                    difference = difference || getSourceReadinessSortRank(left.readiness) - getSourceReadinessSortRank(right.readiness);
            }
            return difference || left.index - right.index;
        }).map(({ stream }) => stream);
};

module.exports = { filterAndSortSources };
