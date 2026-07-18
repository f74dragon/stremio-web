/* global jest, describe, beforeEach, afterEach, test, expect */

const {
    LOCAL_BACKEND_BASE_URL,
    getBackendSettings,
    updateBackendSettings,
    startAllDebridPinAuth,
    checkAllDebridAvailability,
    getAllDebridAvailabilityHistory,
    selectPlayerExecutable,
    moveDownloadInQueue
} = require('../src/customStremio/localBackendClient');

const createJsonResponse = (body, { ok = true, status = 200 } = {}) => ({
    ok,
    status,
    text: jest.fn().mockResolvedValue(JSON.stringify(body))
});

describe('localBackendClient settings', () => {
    beforeEach(() => {
        global.fetch = jest.fn();
    });

    afterEach(() => {
        delete global.fetch;
        jest.restoreAllMocks();
    });

    test('loads local backend settings', async () => {
        const responseBody = { downloads: { maxConcurrentDownloads: 2 } };
        global.fetch.mockResolvedValue(createJsonResponse(responseBody));

        await expect(getBackendSettings()).resolves.toEqual(responseBody);
        expect(global.fetch).toHaveBeenCalledWith(`${LOCAL_BACKEND_BASE_URL}/settings`, {
            headers: {}
        });
    });

    test('patches local backend settings as JSON', async () => {
        const settings = { downloads: { maxConcurrentDownloads: 3 } };
        global.fetch.mockResolvedValue(createJsonResponse(settings));

        await expect(updateBackendSettings(settings)).resolves.toEqual(settings);
        expect(global.fetch).toHaveBeenCalledWith(`${LOCAL_BACKEND_BASE_URL}/settings`, {
            method: 'PATCH',
            body: JSON.stringify(settings),
            headers: { 'Content-Type': 'application/json' }
        });
    });

    test('rejects invalid settings before making a request', async () => {
        await expect(updateBackendSettings(null)).rejects.toThrow('updateBackendSettings requires a settings object');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('starts PIN auth and checks hashes through backend-only AllDebrid routes', async () => {
        const pin = { pin: 'ABCD', userUrl: 'https://alldebrid.com/pin/?pin=ABCD' };
        global.fetch.mockResolvedValueOnce(createJsonResponse(pin));
        await expect(startAllDebridPinAuth()).resolves.toEqual(pin);
        expect(global.fetch).toHaveBeenNthCalledWith(1, `${LOCAL_BACKEND_BASE_URL}/debrid/alldebrid/auth/pin`, {
            method: 'POST',
            headers: {}
        });

        const result = { provider: 'alldebrid', connected: true, items: [] };
        global.fetch.mockResolvedValueOnce(createJsonResponse(result));
        await expect(checkAllDebridAvailability(['842783e3005495d5d1637f5364b59343c7844707'])).resolves.toEqual(result);
        expect(global.fetch).toHaveBeenNthCalledWith(2, `${LOCAL_BACKEND_BASE_URL}/debrid/alldebrid/availability`, {
            method: 'POST',
            body: JSON.stringify({ hashes: ['842783e3005495d5d1637f5364b59343c7844707'] }),
            headers: { 'Content-Type': 'application/json' }
        });

        const history = { provider: 'alldebrid', connected: true, items: [{ hash: '842783e3005495d5d1637f5364b59343c7844707', status: 'cached' }] };
        global.fetch.mockResolvedValueOnce(createJsonResponse(history));
        await expect(getAllDebridAvailabilityHistory(['842783e3005495d5d1637f5364b59343c7844707'])).resolves.toEqual(history);
        expect(global.fetch).toHaveBeenNthCalledWith(3, `${LOCAL_BACKEND_BASE_URL}/debrid/alldebrid/availability/history`, {
            method: 'POST',
            body: JSON.stringify({ hashes: ['842783e3005495d5d1637f5364b59343c7844707'] }),
            headers: { 'Content-Type': 'application/json' }
        });
    });

    test('moves a waiting download to a one-based queue position', async () => {
        const responseBody = { id: 'queue-id', status: 'queued', queuePosition: 1, queueLength: 3 };
        global.fetch.mockResolvedValue(createJsonResponse(responseBody));

        await expect(moveDownloadInQueue('queue-id', 1)).resolves.toEqual(responseBody);
        expect(global.fetch).toHaveBeenCalledWith(`${LOCAL_BACKEND_BASE_URL}/downloads/queue-id/queue`, {
            method: 'PATCH',
            body: JSON.stringify({ position: 1 }),
            headers: { 'Content-Type': 'application/json' }
        });
    });

    test('opens the backend-owned native player selector', async () => {
        const responseBody = {
            downloads: { maxConcurrentDownloads: 2 },
            player: { configured: true, executablePath: 'C:\\Program Files\\MPC-HC\\mpc-hc64.exe' }
        };
        global.fetch.mockResolvedValue(createJsonResponse(responseBody));

        await expect(selectPlayerExecutable()).resolves.toEqual(responseBody);
        expect(global.fetch).toHaveBeenCalledWith(`${LOCAL_BACKEND_BASE_URL}/settings/player/select`, {
            method: 'POST',
            headers: {}
        });
    });

    test('rejects invalid queue positions before making a request', async () => {
        await expect(moveDownloadInQueue('queue-id', 0)).rejects.toThrow('positive integer position');
        expect(global.fetch).not.toHaveBeenCalled();
    });
});
