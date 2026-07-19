/* global jest, describe, beforeEach, afterEach, test, expect */

const {
    LOCAL_BACKEND_BASE_URL,
    getBackendSettings,
    updateBackendSettings,
    startAllDebridPinAuth,
    checkAllDebridAvailability,
    getAllDebridAvailabilityHistory,
    startRealDebridDeviceAuth,
    checkRealDebridDeviceAuth,
    disconnectRealDebrid,
    checkRealDebridAvailability,
    probeRealDebridAvailability,
    getRealDebridAvailabilityHistory,
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

    test('uses backend-only Real-Debrid authorization and explicit availability routes', async () => {
        global.fetch
            .mockResolvedValueOnce(createJsonResponse({ userCode: 'ABCD', verificationUrl: 'https://real-debrid.com/device' }))
            .mockResolvedValueOnce(createJsonResponse({ activated: false }))
            .mockResolvedValueOnce(createJsonResponse({ provider: 'realdebrid', items: [] }))
            .mockResolvedValueOnce(createJsonResponse({ provider: 'realdebrid', items: [] }))
            .mockResolvedValueOnce(createJsonResponse({ ok: true, connection: { connected: false } }));

        await startRealDebridDeviceAuth();
        await checkRealDebridDeviceAuth();
        const sources = [{ hash: '842783e3005495d5d1637f5364b59343c7844707', fileIdx: 3 }];
        await checkRealDebridAvailability(sources);
        await getRealDebridAvailabilityHistory(sources);
        await disconnectRealDebrid();

        expect(global.fetch).toHaveBeenNthCalledWith(1, `${LOCAL_BACKEND_BASE_URL}/debrid/realdebrid/auth/device`, {
            method: 'POST',
            headers: {}
        });
        expect(global.fetch).toHaveBeenNthCalledWith(2, `${LOCAL_BACKEND_BASE_URL}/debrid/realdebrid/auth/device/check`, {
            method: 'POST',
            headers: {}
        });
        expect(global.fetch).toHaveBeenNthCalledWith(3, `${LOCAL_BACKEND_BASE_URL}/debrid/realdebrid/availability`, {
            method: 'POST',
            body: JSON.stringify({ sources }),
            headers: { 'Content-Type': 'application/json' }
        });
        expect(global.fetch).toHaveBeenNthCalledWith(4, `${LOCAL_BACKEND_BASE_URL}/debrid/realdebrid/availability/history`, {
            method: 'POST',
            body: JSON.stringify({ sources }),
            headers: { 'Content-Type': 'application/json' }
        });
        expect(global.fetch).toHaveBeenNthCalledWith(5, `${LOCAL_BACKEND_BASE_URL}/debrid/realdebrid/auth`, {
            method: 'DELETE',
            headers: {}
        });
    });

    test('batches large provider history and explicit-check requests within backend route limits', async () => {
        const hashes = Array.from({ length: 101 }, (_, index) => (index + 1).toString(16).padStart(40, '0'));
        const sources = Array.from({ length: 51 }, (_, index) => ({ hash: hashes[index], fileIdx: index }));
        global.fetch
            .mockResolvedValueOnce(createJsonResponse({ provider: 'alldebrid', connected: true, items: [{ hash: hashes[0], status: 'cached' }] }))
            .mockResolvedValueOnce(createJsonResponse({ provider: 'alldebrid', connected: true, items: [{ hash: hashes[100], status: 'uncached' }] }))
            .mockResolvedValueOnce(createJsonResponse({ provider: 'alldebrid', connected: true, items: [] }))
            .mockResolvedValueOnce(createJsonResponse({ provider: 'alldebrid', connected: true, items: [] }))
            .mockResolvedValueOnce(createJsonResponse({ provider: 'realdebrid', connected: true, items: [{ key: 'first', status: 'cached' }] }))
            .mockResolvedValueOnce(createJsonResponse({ provider: 'realdebrid', connected: true, items: [{ key: 'last', status: 'uncached' }] }))
            .mockResolvedValueOnce(createJsonResponse({ provider: 'realdebrid', connected: true, items: [] }))
            .mockResolvedValueOnce(createJsonResponse({ provider: 'realdebrid', connected: true, items: [] }));

        await expect(checkAllDebridAvailability(hashes)).resolves.toMatchObject({
            connected: true,
            items: [{ hash: hashes[0], status: 'cached' }, { hash: hashes[100], status: 'uncached' }]
        });
        await getAllDebridAvailabilityHistory(hashes);
        await expect(checkRealDebridAvailability(sources)).resolves.toMatchObject({
            connected: true,
            items: [{ key: 'first', status: 'cached' }, { key: 'last', status: 'uncached' }]
        });
        await getRealDebridAvailabilityHistory(sources);

        expect(global.fetch).toHaveBeenCalledTimes(8);
        expect(JSON.parse(global.fetch.mock.calls[0][1].body).hashes).toHaveLength(100);
        expect(JSON.parse(global.fetch.mock.calls[1][1].body).hashes).toHaveLength(1);
        expect(JSON.parse(global.fetch.mock.calls[2][1].body).hashes).toHaveLength(100);
        expect(JSON.parse(global.fetch.mock.calls[3][1].body).hashes).toHaveLength(1);
        expect(JSON.parse(global.fetch.mock.calls[4][1].body).sources).toHaveLength(50);
        expect(JSON.parse(global.fetch.mock.calls[5][1].body).sources).toHaveLength(1);
        expect(JSON.parse(global.fetch.mock.calls[6][1].body).sources).toHaveLength(50);
        expect(JSON.parse(global.fetch.mock.calls[7][1].body).sources).toHaveLength(1);
    });

    test('probes one unresolved Real-Debrid resolver source through the backend', async () => {
        const source = {
            hash: '842783e3005495d5d1637f5364b59343c7844707',
            fileIdx: null,
            probeUrl: 'https://resolver.example/download'
        };
        const responseBody = { provider: 'realdebrid', connected: true, item: { ...source, status: 'ready' } };
        global.fetch.mockResolvedValue(createJsonResponse(responseBody));

        await expect(probeRealDebridAvailability(source)).resolves.toEqual(responseBody);
        expect(global.fetch).toHaveBeenCalledWith(`${LOCAL_BACKEND_BASE_URL}/debrid/realdebrid/availability/head`, {
            method: 'POST',
            body: JSON.stringify({ source }),
            headers: { 'Content-Type': 'application/json' }
        });
    });

    test('reports explicit availability progress one source at a time when requested', async () => {
        const hashes = [
            '0000000000000000000000000000000000000001',
            '0000000000000000000000000000000000000002'
        ];
        const onBatchStart = jest.fn();
        const onBatchComplete = jest.fn();
        global.fetch
            .mockResolvedValueOnce(createJsonResponse({ provider: 'alldebrid', connected: true, items: [{ hash: hashes[0], status: 'cached' }] }))
            .mockResolvedValueOnce(createJsonResponse({ provider: 'alldebrid', connected: true, items: [{ hash: hashes[1], status: 'uncached' }] }));

        await expect(checkAllDebridAvailability(hashes, {
            batchSize: 1,
            onBatchStart,
            onBatchComplete
        })).resolves.toMatchObject({
            items: [
                { hash: hashes[0], status: 'cached' },
                { hash: hashes[1], status: 'uncached' }
            ]
        });

        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(onBatchStart).toHaveBeenNthCalledWith(1, {
            batch: [hashes[0]],
            batchIndex: 0,
            totalBatches: 2
        });
        expect(onBatchComplete.mock.calls[0][0]).toMatchObject({
            batch: [hashes[0]],
            batchIndex: 0,
            totalBatches: 2,
            result: { items: [{ hash: hashes[0], status: 'cached' }] }
        });
        expect(onBatchStart).toHaveBeenNthCalledWith(2, {
            batch: [hashes[1]],
            batchIndex: 1,
            totalBatches: 2
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
