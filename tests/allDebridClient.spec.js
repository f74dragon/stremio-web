/* global jest, describe, test, expect */

const { AllDebridClient, AllDebridApiError } = require('../local-backend/allDebridClient');

const response = (body, { ok = true, status = 200 } = {}) => ({
    ok,
    status,
    text: jest.fn().mockResolvedValue(JSON.stringify(body))
});

describe('AllDebridClient', () => {
    test('uses current PIN endpoints without exposing auth parameters in URLs', async () => {
        const fetchImpl = jest.fn()
            .mockResolvedValueOnce(response({ status: 'success', data: { pin: 'ABCD', check: 'check-token' } }))
            .mockResolvedValueOnce(response({ status: 'success', data: { activated: false, expires_in: 500 } }));
        const client = new AllDebridClient({ fetchImpl, minRequestIntervalMs: 0 });

        await expect(client.getPin()).resolves.toMatchObject({ pin: 'ABCD' });
        await expect(client.checkPin('ABCD', 'check-token')).resolves.toMatchObject({ activated: false });
        expect(fetchImpl.mock.calls[0][0]).toBe('https://api.alldebrid.com/v4.1/pin/get');
        expect(fetchImpl.mock.calls[1][0]).toBe('https://api.alldebrid.com/v4/pin/check');
        expect(fetchImpl.mock.calls[1][1].body).toBe('pin=ABCD&check=check-token');
    });

    test('uploads hashes and deletes magnets with bearer authentication', async () => {
        const fetchImpl = jest.fn()
            .mockResolvedValueOnce(response({ status: 'success', data: { magnets: [] } }))
            .mockResolvedValueOnce(response({ status: 'success', data: { message: 'deleted' } }));
        const client = new AllDebridClient({ fetchImpl, minRequestIntervalMs: 0 });
        const hash = '842783e3005495d5d1637f5364b59343c7844707';

        await client.uploadHashes('private-key', [hash]);
        await client.deleteMagnet('private-key', 123);
        expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer private-key');
        expect(fetchImpl.mock.calls[0][1].body).toContain(`magnets%5B%5D=magnet%3A%3Fxt%3Durn%3Abtih%3A${hash}`);
        expect(fetchImpl.mock.calls[1][1].body).toBe('id=123');
    });

    test('returns typed API errors without including credentials', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(response({
            status: 'error',
            error: { code: 'AUTH_BAD_APIKEY', message: 'The auth apikey is invalid' }
        }, { ok: false, status: 401 }));
        const client = new AllDebridClient({ fetchImpl, minRequestIntervalMs: 0 });

        await expect(client.getUser('do-not-print')).rejects.toEqual(expect.objectContaining({
            constructor: AllDebridApiError,
            code: 'AUTH_BAD_APIKEY',
            status: 401
        }));
    });
});
