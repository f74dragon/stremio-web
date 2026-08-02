/* global describe, test, expect, jest */

const { EventEmitter } = require('events');
const {
    MpcHcStatusClient,
    parseMpcHcVariables,
    normalizeWindowsMediaPath,
    isSameWindowsMediaPath
} = require('../local-backend/mpcHcStatusClient');

const createVariablesHtml = ({ state = 2, position = 120000, duration = 300000, filePath = 'C:\\Media\\Movie.mkv' } = {}) => `
    <html><body>
        <p id="filepath">${filePath}</p>
        <p id="state">${state}</p>
        <p id="position">${position}</p>
        <p id="duration">${duration}</p>
    </body></html>
`;

const createRequestMock = ({ statusCode = 200, body = createVariablesHtml() } = {}) => jest.fn((options, onResponse) => {
    const request = new EventEmitter();
    request.setTimeout = jest.fn();
    request.destroy = jest.fn();
    request.end = jest.fn(() => {
        const response = new EventEmitter();
        response.statusCode = statusCode;
        response.resume = jest.fn();
        response.destroy = jest.fn();
        onResponse(response);
        if (statusCode === 200) {
            response.emit('data', Buffer.from(body));
            response.emit('end');
        }
    });
    return request;
});

describe('mpcHcStatusClient', () => {
    test('parses numeric playback values without depending on localized state text', () => {
        expect(parseMpcHcVariables(createVariablesHtml({
            state: 1,
            position: 42000,
            duration: 84000,
            filePath: 'C:\\Shows\\A &amp; B\\Episode.mkv'
        }))).toEqual({
            state: 'paused',
            stateCode: 1,
            positionMs: 42000,
            durationMs: 84000,
            filePath: 'C:\\Shows\\A & B\\Episode.mkv'
        });
    });

    test('rejects missing, malformed, and unsupported variables', () => {
        expect(() => parseMpcHcVariables('<html></html>')).toThrow(expect.objectContaining({ code: 'MPC_HC_RESPONSE_INVALID' }));
        expect(() => parseMpcHcVariables(createVariablesHtml({ state: 9 }))).toThrow(expect.objectContaining({ code: 'MPC_HC_RESPONSE_INVALID' }));
        expect(() => parseMpcHcVariables(createVariablesHtml({ position: '-1' }))).toThrow(expect.objectContaining({ code: 'MPC_HC_RESPONSE_INVALID' }));
    });

    test('matches normalized Windows paths exactly and rejects similar files', () => {
        expect(normalizeWindowsMediaPath('\\\\?\\C:\\Media\\Folder\\..\\Movie.mkv')).toBe('c:\\media\\movie.mkv');
        expect(isSameWindowsMediaPath('C:/Media/Movie.mkv', 'c:\\media\\MOVIE.mkv')).toBe(true);
        expect(isSameWindowsMediaPath('C:\\Media\\Movie.mkv', 'C:\\Media\\Movie (1).mkv')).toBe(false);
        expect(isSameWindowsMediaPath('Movie.mkv', 'C:\\Media\\Movie.mkv')).toBe(false);
    });

    test('always requests the read-only variables page from loopback', async () => {
        const request = createRequestMock();
        const client = new MpcHcStatusClient({ request });
        await expect(client.getStatus(13579)).resolves.toMatchObject({ state: 'playing', positionMs: 120000 });
        expect(request).toHaveBeenCalledWith(expect.objectContaining({
            protocol: 'http:',
            hostname: '127.0.0.1',
            port: 13579,
            path: '/variables.html',
            method: 'GET',
            agent: false
        }), expect.any(Function));
    });

    test('rejects invalid ports, non-success responses, and oversized bodies', async () => {
        const invalidClient = new MpcHcStatusClient({ request: createRequestMock() });
        await expect(invalidClient.getStatus(0)).rejects.toMatchObject({ code: 'MPC_HC_PORT_INVALID' });

        const httpClient = new MpcHcStatusClient({ request: createRequestMock({ statusCode: 404 }) });
        await expect(httpClient.getStatus(13579)).rejects.toMatchObject({ code: 'MPC_HC_HTTP_ERROR' });

        const largeClient = new MpcHcStatusClient({
            request: createRequestMock({ body: 'x'.repeat(100) }),
            maxResponseBytes: 16
        });
        await expect(largeClient.getStatus(13579)).rejects.toMatchObject({ code: 'MPC_HC_RESPONSE_TOO_LARGE' });
    });
});
