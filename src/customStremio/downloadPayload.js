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
            videoSize: Number.isFinite(stream?.behaviorHints?.videoSize) ? stream.behaviorHints.videoSize : null
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
    buildDownloadPayload
};
