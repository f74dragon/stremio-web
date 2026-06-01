const ACTIVE_DOWNLOAD_STATUSES = new Set(['queued', 'downloading', 'paused', 'completed']);

const normalizeValue = (value) => {
    if (value === null || value === undefined) {
        return '';
    }

    return String(value);
};

const getPayloadSourceUrl = (payload) => {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    return payload.downloadUrl || payload.streamingUrl || payload.streamUrl || payload.externalUrl || null;
};

const getRecordSourceUrl = (record) => {
    if (!record || typeof record !== 'object') {
        return null;
    }

    return record.sourceUrl || getPayloadSourceUrl(record);
};

const isActiveDownloadRecord = (record) => ACTIVE_DOWNLOAD_STATUSES.has(normalizeValue(record?.status).toLowerCase());

const doesRecordMatchPayload = (record, payload) => {
    if (!record || !payload) {
        return false;
    }

    if (!isActiveDownloadRecord(record)) {
        return false;
    }

    const recordSourceUrl = normalizeValue(getRecordSourceUrl(record));
    const payloadSourceUrl = normalizeValue(getPayloadSourceUrl(payload));
    if (!recordSourceUrl || !payloadSourceUrl || recordSourceUrl !== payloadSourceUrl) {
        return false;
    }

    const recordMetaId = normalizeValue(record.metaId);
    const payloadMetaId = normalizeValue(payload.metaId);
    if (!recordMetaId || !payloadMetaId || recordMetaId !== payloadMetaId) {
        return false;
    }

    const payloadVideoId = normalizeValue(payload.videoId);
    if (payloadVideoId) {
        return normalizeValue(record.videoId) === payloadVideoId;
    }

    return normalizeValue(record.type) === normalizeValue(payload.type);
};

const findMatchingDownloadRecord = (records, payload) => {
    if (!Array.isArray(records) || !payload) {
        return null;
    }

    return records.find((record) => doesRecordMatchPayload(record, payload)) || null;
};

module.exports = {
    getPayloadSourceUrl,
    getRecordSourceUrl,
    isActiveDownloadRecord,
    doesRecordMatchPayload,
    findMatchingDownloadRecord
};
