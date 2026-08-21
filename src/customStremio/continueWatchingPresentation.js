const NEAR_END_THRESHOLD = 0.9;

const getTimestamp = (value) => {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : 0;
};

const getNextCompletedEpisode = (downloads, current) => (downloads || [])
    .filter((record) => record?.status === 'completed' && record?.type === 'series' && record?.metaId === current?.metaId &&
        Number.isFinite(record?.season) && Number.isFinite(record?.episode) &&
        (record.season > current.season || record.season === current.season && record.episode > current.episode))
    .sort((left, right) => left.season - right.season || left.episode - right.episode)[0] || null;

const buildLocalContinueWatchingItems = (downloads, progressRecords) => {
    const downloadsById = new Map((downloads || []).map((record) => [record?.id, record]));
    const progressByDownloadId = new Map((progressRecords || []).map((record) => [record?.downloadId, record]));
    const latestByMetaId = new Map();

    (progressRecords || []).forEach((progress) => {
        const download = downloadsById.get(progress?.downloadId);
        const exactIdentity = progress?.metaId === download?.metaId && progress?.mediaType === download?.type &&
            (download?.type !== 'series' || progress?.videoId === download?.videoId);
        if (download?.status !== 'completed' || !download?.metaId || !exactIdentity ||
            !Number.isFinite(progress?.positionMs) || progress.positionMs <= 0 ||
            !Number.isFinite(progress?.durationMs) || progress.durationMs <= 0 || progress.positionMs > progress.durationMs) {
            return;
        }
        const current = latestByMetaId.get(download.metaId);
        if (!current || getTimestamp(progress.lastPlayedAt) > getTimestamp(current.progress.lastPlayedAt)) {
            latestByMetaId.set(download.metaId, { download, progress });
        }
    });

    return Array.from(latestByMetaId.values()).flatMap(({ download, progress }) => {
        let targetDownload = download;
        let targetProgress = progress;
        if (Number(progress.progress) >= NEAR_END_THRESHOLD) {
            targetDownload = download.type === 'series' ? getNextCompletedEpisode(downloads, download) : null;
            if (!targetDownload) {
                return [];
            }
            targetProgress = progressByDownloadId.get(targetDownload.id) || null;
            if (Number(targetProgress?.progress) >= NEAR_END_THRESHOLD) {
                return [];
            }
        }

        const percent = targetProgress ? Math.max(1, Math.min(89, Math.round(Number(targetProgress.progress) * 100))) : 1;
        const episodeLabel = targetDownload.type === 'series' && Number.isFinite(targetDownload.season) && Number.isFinite(targetDownload.episode) ?
            `S${targetDownload.season} E${targetDownload.episode}` : null;
        return [{
            _id: targetDownload.metaId,
            type: targetDownload.type,
            name: episodeLabel ? `${targetDownload.parentTitle || targetDownload.videoTitle} · ${episodeLabel}` : targetDownload.parentTitle || targetDownload.videoTitle,
            poster: targetDownload.poster,
            posterShape: 'poster',
            progress: percent,
            watched: false,
            removable: false,
            customStremioLocal: true,
            customStremioDownloadId: targetDownload.id,
            deepLinks: {
                metaDetailsVideos: '#/downloads',
                metaDetailsStreams: null,
                player: null
            },
            localLastPlayedAt: targetProgress?.lastPlayedAt || progress.lastPlayedAt
        }];
    }).sort((left, right) => getTimestamp(right.localLastPlayedAt) - getTimestamp(left.localLastPlayedAt));
};

const mergeLocalContinueWatching = (catalog, downloads, progressRecords) => {
    const nativeItems = Array.isArray(catalog?.items) ? catalog.items : [];
    const localItems = buildLocalContinueWatchingItems(downloads, progressRecords);
    const localById = new Map(localItems.map((item) => [item._id, item]));
    const mergedNative = nativeItems.map((item) => localById.has(item?._id) ? { ...item, ...localById.get(item._id) } : item);
    const nativeIds = new Set(nativeItems.map((item) => item?._id));
    return {
        ...catalog,
        items: [...localItems.filter((item) => !nativeIds.has(item._id)), ...mergedNative]
    };
};

module.exports = {
    NEAR_END_THRESHOLD,
    getNextCompletedEpisode,
    buildLocalContinueWatchingItems,
    mergeLocalContinueWatching
};
