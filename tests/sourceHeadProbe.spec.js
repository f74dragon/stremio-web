/* global jest, describe, afterEach, test, expect */

const { EventEmitter } = require('events');
const http = require('http');
const { probeSourceHead } = require('../local-backend/sourceHeadProbe');

const mockHeadResponse = (statusCode, headers = {}) => {
    const response = new EventEmitter();
    response.statusCode = statusCode;
    response.headers = headers;
    response.destroy = jest.fn();
    return response;
};

describe('source HEAD probe', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('follows redirects and accepts credible media headers without reading a body', async () => {
        const redirect = mockHeadResponse(302, { location: '/files/movie.mkv' });
        const media = mockHeadResponse(200, { 'content-type': 'video/x-matroska', 'content-length': '987654' });
        const responses = [redirect, media];
        const requests = [];
        jest.spyOn(http, 'request').mockImplementation((url, options, callback) => {
            const request = new EventEmitter();
            request.setTimeout = jest.fn();
            request.end = jest.fn(() => callback(responses.shift()));
            request.destroy = jest.fn((error) => error && request.emit('error', error));
            requests.push({ url: url.toString(), options, request });
            return request;
        });

        await expect(probeSourceHead('http://resolver.example/start')).resolves.toMatchObject({
            status: 'ready',
            verification: 'resolver_head',
            contentType: 'video/x-matroska',
            contentLength: 987654
        });
        expect(requests).toHaveLength(2);
        expect(requests.every(({ options }) => options.method === 'HEAD')).toBe(true);
        expect(redirect.listenerCount('data')).toBe(0);
        expect(media.listenerCount('data')).toBe(0);
        expect(redirect.destroy).toHaveBeenCalledTimes(1);
        expect(media.destroy).toHaveBeenCalledTimes(1);
    });

    test.each([
        ['https://torrentio.strem.fun/videos/downloading_v2.mp4', 'uncached', 'SOURCE_NOT_READY'],
        ['https://torrentio.strem.fun/videos/failed_infringement_v2.mp4', 'unavailable', 'SOURCE_UNAVAILABLE']
    ])('classifies a known placeholder redirect to %s', async (location, status, errorCode) => {
        const redirect = mockHeadResponse(302, { location });
        jest.spyOn(http, 'request').mockImplementation((url, options, callback) => {
            const request = new EventEmitter();
            request.setTimeout = jest.fn();
            request.end = jest.fn(() => callback(redirect));
            request.destroy = jest.fn();
            return request;
        });

        await expect(probeSourceHead('http://resolver.example/start')).resolves.toMatchObject({ status, errorCode });
        expect(http.request).toHaveBeenCalledTimes(1);
    });

    test.each([
        [451, 'unavailable'],
        [405, 'unknown'],
        [403, 'unknown'],
        [200, 'unknown']
    ])('classifies HTTP %s conservatively', async (statusCode, expectedStatus) => {
        const response = mockHeadResponse(statusCode, statusCode === 200 ? { 'content-type': 'text/html' } : {});
        jest.spyOn(http, 'request').mockImplementation((url, options, callback) => {
            const request = new EventEmitter();
            request.setTimeout = jest.fn();
            request.end = jest.fn(() => callback(response));
            request.destroy = jest.fn();
            return request;
        });

        await expect(probeSourceHead('http://resolver.example/start')).resolves.toMatchObject({ status: expectedStatus });
    });

    test('does not accept an explicitly empty video response as ready', async () => {
        const response = mockHeadResponse(200, { 'content-type': 'video/mp4', 'content-length': '0' });
        jest.spyOn(http, 'request').mockImplementation((url, options, callback) => {
            const request = new EventEmitter();
            request.setTimeout = jest.fn();
            request.end = jest.fn(() => callback(response));
            request.destroy = jest.fn();
            return request;
        });

        await expect(probeSourceHead('http://resolver.example/video.mp4')).resolves.toMatchObject({ status: 'unknown' });
    });

    test('stops redirect loops at the configured limit', async () => {
        jest.spyOn(http, 'request').mockImplementation((url, options, callback) => {
            const response = mockHeadResponse(302, { location: '/loop' });
            const request = new EventEmitter();
            request.setTimeout = jest.fn();
            request.end = jest.fn(() => callback(response));
            request.destroy = jest.fn();
            return request;
        });

        await expect(probeSourceHead('http://resolver.example/loop', { maxRedirects: 2 })).resolves.toMatchObject({
            status: 'unknown',
            error: 'Resolver HEAD check exceeded the redirect limit.'
        });
        expect(http.request).toHaveBeenCalledTimes(3);
    });

    test('returns unknown when the HEAD request times out', async () => {
        jest.spyOn(http, 'request').mockImplementation(() => {
            const request = new EventEmitter();
            request.setTimeout = jest.fn((timeoutMs, callback) => setImmediate(callback));
            request.end = jest.fn();
            request.destroy = jest.fn((error) => request.emit('error', error));
            return request;
        });

        await expect(probeSourceHead('http://resolver.example/slow', { timeoutMs: 10 })).resolves.toMatchObject({
            status: 'unknown',
            error: 'Resolver HEAD check timed out.'
        });
    });
});
