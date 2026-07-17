const LOCAL_BACKEND_BASE_URL = 'http://127.0.0.1:5577';

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
    createDownload,
    listDownloads,
    getDownload,
    moveDownloadInQueue,
    pauseDownload,
    resumeDownload,
    retryDownload,
    cancelDownload,
    deleteDownload,
    playDownload,
    openDownloadLocation
};
