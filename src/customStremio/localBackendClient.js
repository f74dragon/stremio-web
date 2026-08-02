const LOCAL_BACKEND_BASE_URL = 'http://127.0.0.1:5577';
const ALLDEBRID_AVAILABILITY_BATCH_SIZE = 100;
const REALDEBRID_AVAILABILITY_BATCH_SIZE = 50;

const getJsonBody = async (response) => {
    const text = await response.text();
    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch (_error) {
        return null;
    }
};

const requestJson = async (path, options = {}) => {
    const url = `${LOCAL_BACKEND_BASE_URL}${path}`;
    const headers = {
        ...(options.headers || {})
    };
    const requestOptions = {
        ...options,
        headers
    };

    if (Object.prototype.hasOwnProperty.call(options, 'body')) {
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
        requestOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }

    const response = await fetch(url, requestOptions);
    const data = await getJsonBody(response);

    if (!response.ok) {
        const backendError = typeof data?.error === 'string' && data.error.length > 0 ? data.error : `Request failed with status ${response.status}`;
        const error = new Error(`Local backend request failed (${response.status}): ${backendError}`);
        error.status = response.status;
        error.backendError = backendError;
        error.responseBody = data;
        throw error;
    }

    return data;
};

const requestAvailabilityBatches = async (path, fieldName, items, maxBatchSize, options = {}) => {
    const requestedBatchSize = Number.isSafeInteger(options.batchSize) && options.batchSize > 0 ?
        options.batchSize
        : maxBatchSize;
    const batchSize = Math.min(requestedBatchSize, maxBatchSize);
    const batches = [];
    if (items.length === 0) {
        batches.push([]);
    } else {
        for (let index = 0; index < items.length; index += batchSize) {
            batches.push(items.slice(index, index + batchSize));
        }
    }

    const results = [];
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        const batch = batches[batchIndex];
        const progress = { batch, batchIndex, totalBatches: batches.length };
        if (typeof options.onBatchStart === 'function') {
            options.onBatchStart(progress);
        }
        const result = await requestJson(path, {
            method: 'POST',
            body: { [fieldName]: batch }
        });
        results.push(result);
        if (typeof options.onBatchComplete === 'function') {
            options.onBatchComplete({ ...progress, result });
        }
    }
    if (results.length === 1) {
        return results[0];
    }

    const cleanupWarnings = Array.from(new Set(results
        .map((result) => result?.cleanupWarning)
        .filter((warning) => typeof warning === 'string' && warning.length > 0)));
    return {
        ...results[results.length - 1],
        connected: results.every((result) => result?.connected !== false),
        items: results.flatMap((result) => Array.isArray(result?.items) ? result.items : []),
        cleanupWarning: cleanupWarnings.length > 0 ? cleanupWarnings.join(' ') : null
    };
};

const getBackendHealth = async () => requestJson('/health');

const getBackendSettings = async () => requestJson('/settings');

const updateBackendSettings = async (settings) => {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        throw new Error('updateBackendSettings requires a settings object');
    }

    return requestJson('/settings', {
        method: 'PATCH',
        body: settings
    });
};

const startAllDebridPinAuth = async () => requestJson('/debrid/alldebrid/auth/pin', {
    method: 'POST'
});

const checkAllDebridPinAuth = async () => requestJson('/debrid/alldebrid/auth/pin/check', {
    method: 'POST'
});

const disconnectAllDebrid = async () => requestJson('/debrid/alldebrid/auth', {
    method: 'DELETE'
});

const startRealDebridDeviceAuth = async () => requestJson('/debrid/realdebrid/auth/device', {
    method: 'POST'
});

const checkRealDebridDeviceAuth = async () => requestJson('/debrid/realdebrid/auth/device/check', {
    method: 'POST'
});

const disconnectRealDebrid = async () => requestJson('/debrid/realdebrid/auth', {
    method: 'DELETE'
});

const checkRealDebridAvailability = async (sources, options = {}) => {
    if (!Array.isArray(sources)) {
        throw new Error('checkRealDebridAvailability requires a sources array');
    }
    return requestAvailabilityBatches(
        '/debrid/realdebrid/availability',
        'sources',
        sources,
        REALDEBRID_AVAILABILITY_BATCH_SIZE,
        options
    );
};

const probeRealDebridAvailability = async (source) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new Error('probeRealDebridAvailability requires a source object');
    }
    return requestJson('/debrid/realdebrid/availability/head', {
        method: 'POST',
        body: { source }
    });
};

const getRealDebridAvailabilityHistory = async (sources) => {
    if (!Array.isArray(sources)) {
        throw new Error('getRealDebridAvailabilityHistory requires a sources array');
    }
    return requestAvailabilityBatches(
        '/debrid/realdebrid/availability/history',
        'sources',
        sources,
        REALDEBRID_AVAILABILITY_BATCH_SIZE
    );
};

const selectPlayerExecutable = async () => requestJson('/settings/player/select', {
    method: 'POST'
});

const testMpcHcProgressConnection = async (port) => {
    if (!Number.isSafeInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) {
        throw new Error('testMpcHcProgressConnection requires a valid port');
    }
    return requestJson('/settings/player/progress/test', {
        method: 'POST',
        body: { port: Number(port) }
    });
};

const listPlaybackProgress = async (metaId) => {
    const path = typeof metaId === 'string' && metaId.length > 0 ?
        `/playback/progress?metaId=${encodeURIComponent(metaId)}`
        : '/playback/progress';
    return requestJson(path);
};

const checkAllDebridAvailability = async (hashes, options = {}) => {
    if (!Array.isArray(hashes)) {
        throw new Error('checkAllDebridAvailability requires a hashes array');
    }

    return requestAvailabilityBatches(
        '/debrid/alldebrid/availability',
        'hashes',
        hashes,
        ALLDEBRID_AVAILABILITY_BATCH_SIZE,
        options
    );
};

const getAllDebridAvailabilityHistory = async (hashes) => {
    if (!Array.isArray(hashes)) {
        throw new Error('getAllDebridAvailabilityHistory requires a hashes array');
    }

    return requestAvailabilityBatches(
        '/debrid/alldebrid/availability/history',
        'hashes',
        hashes,
        ALLDEBRID_AVAILABILITY_BATCH_SIZE
    );
};

const createDownload = async (payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('createDownload requires a payload object');
    }

    return requestJson('/downloads', {
        method: 'POST',
        body: payload
    });
};

const listDownloads = async (metaId) => {
    const path = metaId !== undefined && metaId !== null && `${metaId}`.length > 0 ?
        `/downloads?metaId=${encodeURIComponent(String(metaId))}`
        :
        '/downloads';

    return requestJson(path);
};

const listDownloadHistory = async (limit) => {
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
        throw new Error('listDownloadHistory limit must be a positive integer');
    }
    return requestJson(limit === undefined ? '/downloads/history' : `/downloads/history?limit=${limit}`);
};

const requireDownloadIdValue = (id, functionName) => {
    if (id === undefined || id === null || `${id}`.trim().length === 0) {
        throw new Error(`${functionName} requires a download id`);
    }

    return String(id).trim();
};

const requireDownloadId = (id, functionName) => encodeURIComponent(requireDownloadIdValue(id, functionName));

const getDownload = async (id) => requestJson(`/downloads/${requireDownloadId(id, 'getDownload')}`);

const moveDownloadInQueue = async (id, position) => {
    if (!Number.isSafeInteger(position) || position < 1) {
        throw new Error('moveDownloadInQueue requires a positive integer position');
    }

    return requestJson(`/downloads/${requireDownloadId(id, 'moveDownloadInQueue')}/queue`, {
        method: 'PATCH',
        body: { position }
    });
};

const pauseDownload = async (id) => requestJson(`/downloads/${requireDownloadId(id, 'pauseDownload')}/pause`, {
    method: 'POST'
});

const resumeDownload = async (id) => requestJson(`/downloads/${requireDownloadId(id, 'resumeDownload')}/resume`, {
    method: 'POST'
});

const retryDownload = async (id) => requestJson(`/downloads/${requireDownloadId(id, 'retryDownload')}/retry`, {
    method: 'POST'
});

const cancelDownload = async (id) => requestJson(`/downloads/${requireDownloadId(id, 'cancelDownload')}/cancel`, {
    method: 'POST'
});

const deleteDownload = async (id) => requestJson(`/downloads/${requireDownloadId(id, 'deleteDownload')}`, {
    method: 'DELETE'
});

const deleteDownloadMedia = async (id) => requestJson(`/downloads/${requireDownloadId(id, 'deleteDownloadMedia')}/media`, {
    method: 'DELETE'
});

const playDownload = async (id) => requestJson('/play', {
    method: 'POST',
    body: {
        downloadId: requireDownloadIdValue(id, 'playDownload')
    }
});

const openDownloadLocation = async (id) => requestJson(`/downloads/${requireDownloadId(id, 'openDownloadLocation')}/open-location`, {
    method: 'POST'
});

module.exports = {
    LOCAL_BACKEND_BASE_URL,
    requestJson,
    getBackendHealth,
    getBackendSettings,
    updateBackendSettings,
    startAllDebridPinAuth,
    checkAllDebridPinAuth,
    disconnectAllDebrid,
    startRealDebridDeviceAuth,
    checkRealDebridDeviceAuth,
    disconnectRealDebrid,
    checkRealDebridAvailability,
    probeRealDebridAvailability,
    getRealDebridAvailabilityHistory,
    selectPlayerExecutable,
    testMpcHcProgressConnection,
    listPlaybackProgress,
    checkAllDebridAvailability,
    getAllDebridAvailabilityHistory,
    createDownload,
    listDownloads,
    listDownloadHistory,
    getDownload,
    moveDownloadInQueue,
    pauseDownload,
    resumeDownload,
    retryDownload,
    cancelDownload,
    deleteDownload,
    deleteDownloadMedia,
    playDownload,
    openDownloadLocation
};
