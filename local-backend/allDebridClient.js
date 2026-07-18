const ALLDEBRID_API_BASE_URL = 'https://api.alldebrid.com';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MIN_REQUEST_INTERVAL_MS = 110;

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class AllDebridApiError extends Error {
    constructor(message, { code = 'ALLDEBRID_REQUEST_FAILED', status = null } = {}) {
        super(message);
        this.name = 'AllDebridApiError';
        this.code = code;
        this.status = status;
    }
}

const appendFormValue = (form, key, value) => {
    if (Array.isArray(value)) {
        value.forEach((item) => form.append(`${key}[]`, String(item)));
        return;
    }
    if (value !== undefined && value !== null) {
        form.append(key, String(value));
    }
};

class AllDebridClient {
    constructor({
        fetchImpl = global.fetch,
        baseUrl = ALLDEBRID_API_BASE_URL,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        minRequestIntervalMs = DEFAULT_MIN_REQUEST_INTERVAL_MS,
        sleep = wait
    } = {}) {
        if (typeof fetchImpl !== 'function') {
            throw new Error('AllDebridClient requires a fetch implementation');
        }

        this.fetchImpl = fetchImpl;
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.timeoutMs = timeoutMs;
        this.minRequestIntervalMs = minRequestIntervalMs;
        this.sleep = sleep;
        this.lastRequestAt = 0;
        this.requestQueue = Promise.resolve();
    }

    request(path, options = {}) {
        const operation = this.requestQueue.then(async () => {
            const delay = Math.max(0, this.minRequestIntervalMs - (Date.now() - this.lastRequestAt));
            if (delay > 0) {
                await this.sleep(delay);
            }
            this.lastRequestAt = Date.now();
            return this.performRequest(path, options);
        });
        this.requestQueue = operation.catch(() => undefined);
        return operation;
    }

    async performRequest(path, { method = 'GET', apiKey = null, form: formValues = null } = {}) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        const headers = {};
        const requestOptions = { method, headers, signal: controller.signal };

        if (apiKey) {
            headers.Authorization = `Bearer ${apiKey}`;
        }
        if (formValues) {
            const form = new URLSearchParams();
            Object.entries(formValues).forEach(([key, value]) => appendFormValue(form, key, value));
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
            requestOptions.body = form.toString();
        }

        try {
            const response = await this.fetchImpl(`${this.baseUrl}${path}`, requestOptions);
            const responseText = await response.text();
            let document;
            try {
                document = responseText ? JSON.parse(responseText) : null;
            } catch {
                throw new AllDebridApiError('AllDebrid returned an invalid response', { status: response.status });
            }

            if (!response.ok || document?.status !== 'success') {
                throw new AllDebridApiError(
                    document?.error?.message || `AllDebrid request failed with status ${response.status}`,
                    { code: document?.error?.code || 'ALLDEBRID_REQUEST_FAILED', status: response.status }
                );
            }

            return document.data;
        } catch (error) {
            if (error?.name === 'AbortError') {
                throw new AllDebridApiError('AllDebrid request timed out', { code: 'ALLDEBRID_TIMEOUT' });
            }
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    getPin() {
        return this.request('/v4.1/pin/get');
    }

    checkPin(pin, check) {
        return this.request('/v4/pin/check', {
            method: 'POST',
            form: { pin, check }
        });
    }

    getUser(apiKey) {
        return this.request('/v4/user', { apiKey });
    }

    getMagnets(apiKey) {
        return this.request('/v4.1/magnet/status', { method: 'POST', apiKey });
    }

    uploadHashes(apiKey, hashes) {
        return this.request('/v4/magnet/upload', {
            method: 'POST',
            apiKey,
            form: {
                magnets: hashes.map((hash) => `magnet:?xt=urn:btih:${hash}`)
            }
        });
    }

    deleteMagnet(apiKey, id) {
        return this.request('/v4/magnet/delete', {
            method: 'POST',
            apiKey,
            form: { id }
        });
    }
}

module.exports = {
    ALLDEBRID_API_BASE_URL,
    DEFAULT_TIMEOUT_MS,
    DEFAULT_MIN_REQUEST_INTERVAL_MS,
    AllDebridApiError,
    AllDebridClient
};
