const toIsoDateOrNull = (value) => {
    return value instanceof Date && !isNaN(value.getTime()) ?
        value.toISOString()
        :
        null;
};

const buildDownloadPayload = (input) => {
    const metaId = input?.metaId ?? null;
    const type = input?.type ?? null;
    const video = input?.video ?? null;
    const addonName = input?.addonName ?? null;
    const stream = input?.stream ?? null;
    const deepLinks = stream?.deepLinks ?? null;
    const externalPlayer = deepLinks?.externalPlayer ?? null;

    return {
        metaId,
        type,
        videoId: video?.id ?? null,
        videoTitle: video?.title ?? null,
        season: typeof video?.season === 'number' ? video.season : null,
        episode: typeof video?.episode === 'number' ? video.episode : null,
        videoReleased: toIsoDateOrNull(video?.released),
        addonName,
        streamName: stream?.name ?? null,
        streamDescription: stream?.description ?? null,
        streamUrl: stream?.url ?? null,
        externalUrl: stream?.externalUrl ?? null,
        downloadUrl: externalPlayer?.download ?? null,
        fileName: externalPlayer?.fileName ?? null,
        streamingUrl: externalPlayer?.streaming ?? null
    };
};

module.exports = {
    buildDownloadPayload
};
