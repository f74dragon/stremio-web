/* global jest, describe, afterEach, test, expect */

const { EventEmitter } = require('events');
const http = require('http');

jest.mock('../local-backend/fileUtils', () => ({
    deriveLocalPath: () => 'C:\\tmp\\custom-stremio-source-readiness-test.mkv',
    ensureParentDirectory: jest.fn(() => Promise.resolve()),
    derivePartialPath: () => 'C:\\tmp\\custom-stremio-source-readiness-test.mkv.part',
    finalizePartialDownload: jest.fn(() => Promise.resolve())
}));

const fileUtils = require('../local-backend/fileUtils');
const { startDownload } = require('../local-backend/downloadManager');

describe('download manager source readiness', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        jest.clearAllMocks();
    });

    test('rejects the Torrentio placeholder redirect before requesting or writing it', async () => {
        const request = new EventEmitter();
        request.setTimeout = jest.fn();
        request.destroyed = false;
        const response = new EventEmitter();
        response.statusCode = 302;
        response.headers = {
            location: 'https://torrentio.strem.fun/videos/downloading_v2.mp4'
        };
        response.resume = jest.fn();
        response.destroyed = false;

        const getSpy = jest.spyOn(http, 'get').mockImplementation((url, options, callback) => {
            setImmediate(() => callback(response));
            return request;
        });
        const updates = [];

        await startDownload({
            id: 'source-not-ready-test',
            sourceUrl: 'http://source.example/resolve',
            parentTitle: 'Test Movie',
            type: 'movie'
        }, (id, update) => updates.push({ id, update }));

        expect(getSpy).toHaveBeenCalledTimes(1);
        expect(response.resume).toHaveBeenCalledTimes(1);
        expect(fileUtils.finalizePartialDownload).not.toHaveBeenCalled();
        expect(updates.at(-1)).toMatchObject({
            id: 'source-not-ready-test',
            update: {
                status: 'failed',
                errorCode: 'SOURCE_NOT_READY',
                error: 'This debrid source is still being prepared. Choose another cached source or try again later.'
            }
        });
    });

    test('rejects Real-Debrid infringement placeholders before requesting or writing them', async () => {
        const request = new EventEmitter();
        request.setTimeout = jest.fn();
        request.destroyed = false;
        const response = new EventEmitter();
        response.statusCode = 302;
        response.headers = {
            location: 'https://torrentio.strem.fun/videos/failed_infringement_v2.mp4'
        };
        response.resume = jest.fn();
        response.destroyed = false;

        const getSpy = jest.spyOn(http, 'get').mockImplementation((url, options, callback) => {
            setImmediate(() => callback(response));
            return request;
        });
        const updates = [];

        await startDownload({
            id: 'source-infringement-test',
            sourceUrl: 'http://source.example/resolve',
            parentTitle: 'Test Movie',
            type: 'movie'
        }, (id, update) => updates.push({ id, update }));

        expect(getSpy).toHaveBeenCalledTimes(1);
        expect(response.resume).toHaveBeenCalledTimes(1);
        expect(fileUtils.finalizePartialDownload).not.toHaveBeenCalled();
        expect(updates.at(-1)).toMatchObject({
            id: 'source-infringement-test',
            update: {
                status: 'failed',
                errorCode: 'SOURCE_UNAVAILABLE',
                error: 'This debrid source was rejected or removed by the provider. Choose another cached source.'
            }
        });
    });

    test('classifies an HTTP 451 media response as unavailable', async () => {
        const request = new EventEmitter();
        request.setTimeout = jest.fn();
        request.destroyed = false;
        const response = new EventEmitter();
        response.statusCode = 451;
        response.headers = {};
        response.resume = jest.fn();
        response.destroyed = false;

        jest.spyOn(http, 'get').mockImplementation((url, options, callback) => {
            setImmediate(() => callback(response));
            return request;
        });
        const updates = [];

        await startDownload({
            id: 'source-http-451-test',
            sourceUrl: 'http://source.example/infringing',
            parentTitle: 'Test Movie',
            type: 'movie'
        }, (id, update) => updates.push({ id, update }));

        expect(response.resume).toHaveBeenCalledTimes(1);
        expect(fileUtils.finalizePartialDownload).not.toHaveBeenCalled();
        expect(updates.at(-1)).toMatchObject({
            update: {
                status: 'failed',
                errorCode: 'SOURCE_UNAVAILABLE'
            }
        });
    });
});
