/* global jest, describe, beforeEach, afterEach, test, expect */

const {
    LOCAL_BACKEND_BASE_URL,
    getBackendSettings,
    updateBackendSettings
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
});
