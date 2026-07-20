const MEDIA_DELETABLE_STATUSES = new Set(['paused', 'completed', 'failed', 'canceled']);

const isDownloadMediaSelectable = (record) => {
    return Boolean(record?.id && MEDIA_DELETABLE_STATUSES.has(record?.status));
};

const getSelectableDownloadIds = (records) => {
    if (!Array.isArray(records)) {
        return [];
    }

    return Array.from(new Set(records
        .filter(isDownloadMediaSelectable)
        .map((record) => String(record.id))));
};

const getSelectionState = (records, selectedRecordIds) => {
    const selectableIds = getSelectableDownloadIds(records);
    const selectedIds = selectedRecordIds instanceof Set ? selectedRecordIds : new Set(selectedRecordIds || []);
    const selectedCount = selectableIds.filter((id) => selectedIds.has(id)).length;
    return {
        selectableIds,
        selectableCount: selectableIds.length,
        selectedCount,
        allSelected: selectableIds.length > 0 && selectedCount === selectableIds.length,
        partiallySelected: selectedCount > 0 && selectedCount < selectableIds.length
    };
};

const getSeriesEpisodeKey = (record, index = 0) => {
    const videoId = typeof record?.videoId === 'string' ? record.videoId.trim() : '';
    if (videoId) {
        return `video:${videoId}`;
    }
    if (typeof record?.season === 'number' && typeof record?.episode === 'number') {
        return `episode:${record.season}:${record.episode}`;
    }
    return `record:${record?.id || index}`;
};

const groupSeriesRecordsByEpisode = (records) => {
    if (!Array.isArray(records)) {
        return [];
    }

    const groups = new Map();
    records.forEach((record, index) => {
        const key = getSeriesEpisodeKey(record, index);
        const existing = groups.get(key);
        if (existing) {
            existing.records.push(record);
        } else {
            groups.set(key, {
                key,
                season: typeof record?.season === 'number' ? record.season : null,
                episode: typeof record?.episode === 'number' ? record.episode : null,
                title: record?.videoTitle || record?.streamName || 'Untitled episode',
                records: [record]
            });
        }
    });
    return Array.from(groups.values());
};

const getErrorCode = (error) => error?.responseBody?.errorCode || error?.code || null;

const executeDownloadMediaBatch = async ({
    records,
    recordIds,
    deleteMedia,
    removeRecord,
    cancelDownload,
    onStep
}) => {
    const requestedIds = Array.from(new Set((recordIds || []).map((id) => String(id)).filter(Boolean)));
    const requestedIdSet = new Set(requestedIds);
    const recordsById = new Map((records || []).filter((record) => record?.id).map((record) => [String(record.id), record]));
    const successes = [];
    const failures = [];

    for (let index = 0; index < requestedIds.length; index += 1) {
        const recordId = requestedIds[index];
        const record = recordsById.get(recordId);
        let outcome;
        if (!isDownloadMediaSelectable(record)) {
            outcome = {
                id: recordId,
                ok: false,
                errorCode: 'DOWNLOAD_MEDIA_NOT_DELETABLE',
                error: 'This download is active or no longer available for local-media deletion.'
            };
        } else {
            try {
                await deleteMedia(recordId);
                outcome = { id: recordId, ok: true, mode: 'media' };
            } catch (error) {
                const sharedRecordIds = Array.isArray(error?.responseBody?.sharedRecordIds) ?
                    error.responseBody.sharedRecordIds.map(String)
                    : [];
                const canResolveSelectedDuplicates = getErrorCode(error) === 'DOWNLOAD_MEDIA_SHARED_RECORDS' &&
                    sharedRecordIds.length > 0 && sharedRecordIds.every((sharedId) => requestedIdSet.has(sharedId));

                if (canResolveSelectedDuplicates) {
                    try {
                        if (record.status === 'paused') {
                            await cancelDownload(recordId);
                        }
                        await removeRecord(recordId);
                        outcome = { id: recordId, ok: true, mode: 'duplicate_record' };
                    } catch (duplicateError) {
                        outcome = {
                            id: recordId,
                            ok: false,
                            errorCode: getErrorCode(duplicateError),
                            error: duplicateError?.backendError || duplicateError?.message || 'Could not safely remove the duplicate record.'
                        };
                    }
                } else {
                    outcome = {
                        id: recordId,
                        ok: false,
                        errorCode: getErrorCode(error),
                        error: error?.backendError || error?.message || 'Could not delete this download.'
                    };
                }
            }
        }

        if (outcome.ok) {
            successes.push(outcome);
        } else {
            failures.push(outcome);
        }
        onStep?.({ outcome, completed: index + 1, total: requestedIds.length });
    }

    return { requested: requestedIds.length, successes, failures };
};

module.exports = {
    MEDIA_DELETABLE_STATUSES,
    isDownloadMediaSelectable,
    getSelectableDownloadIds,
    getSelectionState,
    getSeriesEpisodeKey,
    groupSeriesRecordsByEpisode,
    executeDownloadMediaBatch
};
