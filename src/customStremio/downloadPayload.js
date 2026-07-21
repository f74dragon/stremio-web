const {
    classifyProviderSourceReadiness,
    getDebridProvider,
    getStreamInfoHash
} = require('./debridSourceReadiness');

const toIsoDateOrNull = (value) => {
    return value instanceof Date && !isNaN(value.getTime()) ?
        value.toISOString()
        :
        null;
};

const normalizeInfoHash = (value) => {
    const hash = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return /^[a-f0-9]{40}$/.test(hash) ? hash : null;
};

const STREAM_SIZE_UNITS = Object.freeze({
    b: 1,
    byte: 1,
    bytes: 1,
    kb: 1024,
    kib: 1024,
    mb: 1024 ** 2,
    mib: 1024 ** 2,
    gb: 1024 ** 3,
    gib: 1024 ** 3,
    tb: 1024 ** 4,
    tib: 1024 ** 4
});

const parseStreamVideoSize = (stream) => {
    const hintedSize = Number(stream?.behaviorHints?.videoSize);
    if (Number.isFinite(hintedSize) && hintedSize > 0) {
        return Math.round(hintedSize);
    }

    const sourceText = [stream?.name, stream?.title, stream?.description, stream?.behaviorHints?.filename]
        .filter((value) => typeof value === 'string' && value.trim())
        .join(' ');
    const matches = Array.from(sourceText.matchAll(/(?:^|[^\d.])(\d+(?:[.,]\d+)?)\s*(TiB|TB|GiB|GB|MiB|MB|KiB|KB|bytes?|B)\b/gi));
    const parsedSizes = matches.map((match) => {
        const value = Number(match[1].replace(',', '.'));
        const multiplier = STREAM_SIZE_UNITS[match[2].toLowerCase()];
        return Number.isFinite(value) && multiplier ? Math.round(value * multiplier) : 0;
    });
    return parsedSizes.length > 0 ? Math.max(...parsedSizes) : null;
};

const buildDownloadPayload = (input) => {
    const metaId = input?.metaId ?? null;
    const type = input?.type ?? null;
    const video = input?.video ?? null;
    const parentTitle = input?.parentTitle ?? null;
    const mediaMetadata = input?.mediaMetadata ?? null;
    const poster = input?.poster ?? null;
    const background = input?.background ?? null;
    const addonName = input?.addonName ?? null;
    const stream = input?.stream ?? null;
    const providerContext = stream ? { ...stream, addonName: stream.addonName ?? addonName } : { addonName };
    const deepLinks = stream?.deepLinks ?? null;
    const externalPlayer = deepLinks?.externalPlayer ?? null;

    return {
        metaId,
        type,
        parentTitle: parentTitle || video?.title || null,
        poster,
        background,
        logo: mediaMetadata?.logo ?? null,
        description: mediaMetadata?.description ?? null,
        runtime: mediaMetadata?.runtime ?? null,
        releaseInfo: mediaMetadata?.releaseInfo ?? null,
        titleReleased: toIsoDateOrNull(mediaMetadata?.released),
        metaLinks: Array.isArray(mediaMetadata?.links) ? mediaMetadata.links.map((link) => ({
            category: link?.category ?? null,
            name: link?.name ?? null,
            url: link?.url ?? null
        })) : [],
        videoId: video?.id ?? null,
        videoTitle: video?.title ?? null,
        videoThumbnail: video?.thumbnail ?? null,
        season: typeof video?.season === 'number' ? video.season : null,
        episode: typeof video?.episode === 'number' ? video.episode : null,
        videoReleased: toIsoDateOrNull(video?.released),
        addonName,
        debridProvider: getDebridProvider(providerContext),
        streamName: stream?.name ?? null,
        streamDescription: stream?.description ?? null,
        sourceReadiness: classifyProviderSourceReadiness(providerContext),
        infoHash: getStreamInfoHash(stream) || normalizeInfoHash(stream?.infoHash),
        fileIdx: Number.isSafeInteger(stream?.fileIdx) ? stream.fileIdx : null,
        behaviorHints: {
            filename: stream?.behaviorHints?.filename ?? null,
            videoSize: parseStreamVideoSize(stream)
        },
        streamUrl: stream?.url ?? null,
        externalUrl: stream?.externalUrl ?? null,
        downloadUrl: externalPlayer?.download ?? null,
        fileName: externalPlayer?.fileName ?? null,
        streamingUrl: externalPlayer?.streaming ?? null
    };
};

module.exports = {
    normalizeInfoHash,
    parseStreamVideoSize,
    buildDownloadPayload
};
