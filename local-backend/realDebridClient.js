const REALDEBRID_REST_BASE_URL = 'https://api.real-debrid.com/rest/1.0';
const REALDEBRID_OAUTH_BASE_URL = 'https://api.real-debrid.com/oauth/v2';
const REALDEBRID_OPEN_SOURCE_CLIENT_ID = 'X245A4XAIBGVM';
const REALDEBRID_DEVICE_GRANT_TYPE = 'http://oauth.net/grant_type/device/1.0';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MIN_REQUEST_INTERVAL_MS = 260;

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class RealDebridApiError extends Error {
    constructor(message, { code = 'REALDEBRID_REQUEST_FAILED', status = null, providerCode = null } = {}) {
        super(message);
        this.name = 'RealDebridApiError';
        this.code = code;
        this.status = status;
        this.providerCode = providerCode;
    }
}

class RealDebridClient {
    constructor({
        fetchImpl = global.fetch,
        restBaseUrl = REALDEBRID_REST_BASE_URL,
        oauthBaseUrl = REALDEBRID_OAUTH_BASE_URL,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        minRequestIntervalMs = DEFAULT_MIN_REQUEST_INTERVAL_MS,
        sleep = wait
    } = {}) {
        if (typeof fetchImpl !== 'function') {
            throw new Error('RealDebridClient requires a fetch implementation');
        }
        this.fetchImpl = fetchImpl;
        this.restBaseUrl = restBaseUrl.replace(/\/$/, '');
        this.oauthBaseUrl = oauthBaseUrl.replace(/\/$/, '');
        this.timeoutMs = timeoutMs;
        this.minRequestIntervalMs = minRequestIntervalMs;
        this.sleep = sleep;
        this.lastRequestAt = 0;
        this.requestQueue = Promise.resolve();
    }

    request(url, options = {}) {
        const operation = this.requestQueue.then(async () => {
            const delay = Math.max(0, this.minRequestIntervalMs - (Date.now() - this.lastRequestAt));
            if (delay > 0) {
                await this.sleep(delay);
            }
            this.lastRequestAt = Date.now();
            return this.performRequest(url, options);
        });
        this.requestQueue = operation.catch(() => undefined);
        return operation;
    }

    async performRequest(url, { method = 'GET', accessToken = null, form = null, pendingAllowed = false } = {}) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        const headers = {};
        const requestOptions = { method, headers, signal: controller.signal };
        if (accessToken) {
            headers.Authorization = `Bearer ${accessToken}`;
        }
        if (form) {
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
            requestOptions.body = new URLSearchParams(Object.entries(form).map(([key, value]) => [key, String(value)])).toString();
        }

        try {
            const response = await this.fetchImpl(url, requestOptions);
            const responseText = await response.text();
            let document = null;
            if (responseText) {
                try {
                    document = JSON.parse(responseText);
                } catch {
                    throw new RealDebridApiError('Real-Debrid returned an invalid response', { status: response.status });
                }
            }

            if (!response.ok) {
                if (pendingAllowed && [400, 403, 404].includes(response.status)) {
                    return null;
                }
                throw new RealDebridApiError(
                    document?.error || `Real-Debrid request failed with status ${response.status}`,
                    {
                        code: response.status === 401 ? 'REALDEBRID_BAD_TOKEN' : 'REALDEBRID_REQUEST_FAILED',
                        status: response.status,
                        providerCode: document?.error_code ?? null
                    }
                );
            }
            return document;
        } catch (error) {
            if (error?.name === 'AbortError') {
                throw new RealDebridApiError('Real-Debrid request timed out', { code: 'REALDEBRID_TIMEOUT' });
            }
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    getDeviceCode(clientId = REALDEBRID_OPEN_SOURCE_CLIENT_ID) {
        const query = new URLSearchParams({ client_id: clientId, new_credentials: 'yes' });
        return this.request(`${this.oauthBaseUrl}/device/code?${query}`);
    }

    getDeviceCredentials(clientId, deviceCode) {
        const query = new URLSearchParams({ client_id: clientId, code: deviceCode });
        return this.request(`${this.oauthBaseUrl}/device/credentials?${query}`, { pendingAllowed: true });
    }

    getToken(clientId, clientSecret, code) {
        return this.request(`${this.oauthBaseUrl}/token`, {
            method: 'POST',
            form: {
                client_id: clientId,
                client_secret: clientSecret,
                code,
                grant_type: REALDEBRID_DEVICE_GRANT_TYPE
            }
        });
    }

    refreshAccessToken(clientId, clientSecret, refreshToken) {
        return this.getToken(clientId, clientSecret, refreshToken);
    }

    getUser(accessToken) {
        return this.request(`${this.restBaseUrl}/user`, { accessToken });
    }

    disableAccessToken(accessToken) {
        return this.request(`${this.restBaseUrl}/disable_access_token`, { accessToken });
    }

    getTorrents(accessToken, { page = 1, limit = 5000 } = {}) {
        const query = new URLSearchParams({ page: String(page), limit: String(limit) });
        return this.request(`${this.restBaseUrl}/torrents?${query}`, { accessToken });
    }

    getTorrentInfo(accessToken, id) {
        return this.request(`${this.restBaseUrl}/torrents/info/${encodeURIComponent(String(id))}`, { accessToken });
    }

    addMagnet(accessToken, hash) {
        return this.request(`${this.restBaseUrl}/torrents/addMagnet`, {
            method: 'POST',
            accessToken,
            form: { magnet: `magnet:?xt=urn:btih:${hash}` }
        });
    }

    selectFiles(accessToken, id, fileIds) {
        return this.request(`${this.restBaseUrl}/torrents/selectFiles/${encodeURIComponent(String(id))}`, {
            method: 'POST',
            accessToken,
            form: { files: fileIds.map(String).join(',') }
        });
    }

    deleteTorrent(accessToken, id) {
        return this.request(`${this.restBaseUrl}/torrents/delete/${encodeURIComponent(String(id))}`, {
            method: 'DELETE',
            accessToken
        });
    }
}

module.exports = {
    REALDEBRID_REST_BASE_URL,
    REALDEBRID_OAUTH_BASE_URL,
    REALDEBRID_OPEN_SOURCE_CLIENT_ID,
    REALDEBRID_DEVICE_GRANT_TYPE,
    DEFAULT_TIMEOUT_MS,
    DEFAULT_MIN_REQUEST_INTERVAL_MS,
    RealDebridApiError,
    RealDebridClient
};
