/* global jest, describe, test, expect */

const {
    REALDEBRID_OPEN_SOURCE_CLIENT_ID,
    REALDEBRID_DEVICE_GRANT_TYPE,
    RealDebridApiError,
    RealDebridClient
} = require('../local-backend/realDebridClient');

const response = (body, { ok = true, status = 200 } = {}) => ({
    ok,
    status,
    text: jest.fn().mockResolvedValue(body === null ? '' : JSON.stringify(body))
});

describe('RealDebridClient', () => {
    test('starts the documented open-source device authorization flow', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(response({ device_code: 'device', user_code: 'CODE' }));
        const client = new RealDebridClient({ fetchImpl, minRequestIntervalMs: 0 });

        await client.getDeviceCode();

        const url = new URL(fetchImpl.mock.calls[0][0]);
        expect(url.pathname).toBe('/oauth/v2/device/code');
        expect(url.searchParams.get('client_id')).toBe(REALDEBRID_OPEN_SOURCE_CLIENT_ID);
        expect(url.searchParams.get('new_credentials')).toBe('yes');
    });

    test('treats pending device credentials as not activated', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(response({ error: 'authorization_pending' }, { ok: false, status: 403 }));
        const client = new RealDebridClient({ fetchImpl, minRequestIntervalMs: 0 });

        await expect(client.getDeviceCredentials('client', 'device')).resolves.toBeNull();
    });

    test('exchanges and refreshes tokens without putting secrets in the URL', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(response({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }));
        const client = new RealDebridClient({ fetchImpl, minRequestIntervalMs: 0 });

        await client.getToken('bound-client', 'bound-secret', 'device-or-refresh-code');

        const [url, options] = fetchImpl.mock.calls[0];
        expect(url).toBe('https://api.real-debrid.com/oauth/v2/token');
        expect(url).not.toContain('bound-secret');
        expect(options.method).toBe('POST');
        const form = new URLSearchParams(options.body);
        expect(form.get('client_id')).toBe('bound-client');
        expect(form.get('client_secret')).toBe('bound-secret');
        expect(form.get('code')).toBe('device-or-refresh-code');
        expect(form.get('grant_type')).toBe(REALDEBRID_DEVICE_GRANT_TYPE);
    });

    test('uses bearer authentication for account access and token revocation', async () => {
        const fetchImpl = jest.fn()
            .mockResolvedValueOnce(response({ id: 42, username: 'viewer' }))
            .mockResolvedValueOnce(response(null, { status: 204 }));
        const client = new RealDebridClient({ fetchImpl, minRequestIntervalMs: 0 });

        await client.getUser('private-access-token');
        await client.disableAccessToken('private-access-token');

        expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer private-access-token');
        expect(fetchImpl.mock.calls[1][0]).toBe('https://api.real-debrid.com/rest/1.0/disable_access_token');
        expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe('Bearer private-access-token');
    });

    test('uses documented torrent endpoints for explicit temporary availability checks', async () => {
        const hash = '842783e3005495d5d1637f5364b59343c7844707';
        const fetchImpl = jest.fn()
            .mockResolvedValueOnce(response([]))
            .mockResolvedValueOnce(response({ id: 'temporary-id' }))
            .mockResolvedValueOnce(response({ id: 'temporary-id', status: 'waiting_files_selection', files: [] }))
            .mockResolvedValueOnce(response(null, { status: 204 }))
            .mockResolvedValueOnce(response(null, { status: 204 }));
        const client = new RealDebridClient({ fetchImpl, minRequestIntervalMs: 0 });

        await client.getTorrents('private-access-token');
        await client.addMagnet('private-access-token', hash);
        await client.getTorrentInfo('private-access-token', 'temporary-id');
        await client.selectFiles('private-access-token', 'temporary-id', ['3']);
        await client.deleteTorrent('private-access-token', 'temporary-id');

        expect(fetchImpl.mock.calls[0][0]).toBe('https://api.real-debrid.com/rest/1.0/torrents?page=1&limit=5000');
        expect(fetchImpl.mock.calls[1][0]).toBe('https://api.real-debrid.com/rest/1.0/torrents/addMagnet');
        expect(fetchImpl.mock.calls[1][1].body).toContain(hash);
        expect(fetchImpl.mock.calls[2][0]).toBe('https://api.real-debrid.com/rest/1.0/torrents/info/temporary-id');
        expect(fetchImpl.mock.calls[3][1].body).toBe('files=3');
        expect(fetchImpl.mock.calls[4][1].method).toBe('DELETE');
    });

    test('returns typed authentication errors without including credentials', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(response({ error: 'bad_token', error_code: 8 }, { ok: false, status: 401 }));
        const client = new RealDebridClient({ fetchImpl, minRequestIntervalMs: 0 });

        const error = await client.getUser('do-not-print').catch((caught) => caught);
        expect(error).toEqual(expect.objectContaining({
            constructor: RealDebridApiError,
            code: 'REALDEBRID_BAD_TOKEN',
            status: 401,
            providerCode: 8
        }));
        expect(error.message).not.toContain('do-not-print');
    });
});
