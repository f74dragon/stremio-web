/* global jest, describe, beforeEach, afterEach, test, expect */

const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');

jest.mock('child_process', () => ({
    spawn: jest.fn()
}));

const { spawn } = require('child_process');
const { getExplorerTarget, openDownloadLocation } = require('../local-backend/fileExplorerLauncher');

describe('fileExplorerLauncher', () => {
    let tempDirectory;
    let mediaPath;

    beforeEach(() => {
        tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-stremio-location-'));
        const downloadDirectory = path.join(tempDirectory, 'Movie With Spaces');
        fs.mkdirSync(downloadDirectory);
        mediaPath = path.join(downloadDirectory, 'video file.mkv');
        spawn.mockReset();
    });

    afterEach(() => {
        fs.rmSync(tempDirectory, { recursive: true, force: true });
    });

    test('selects an existing media file in Explorer', async () => {
        fs.writeFileSync(mediaPath, 'test media');

        await expect(getExplorerTarget(mediaPath)).resolves.toEqual({
            directoryPath: path.dirname(mediaPath),
            arguments: ['/select,', mediaPath]
        });
    });

    test('opens the containing directory when the expected file is absent', async () => {
        await expect(getExplorerTarget(mediaPath)).resolves.toEqual({
            directoryPath: path.dirname(mediaPath),
            arguments: [path.dirname(mediaPath)]
        });
    });

    test('opens Explorer without using a shell', async () => {
        fs.writeFileSync(mediaPath, 'test media');
        const childProcess = new EventEmitter();
        childProcess.unref = jest.fn();
        spawn.mockImplementation(() => {
            process.nextTick(() => childProcess.emit('spawn'));
            return childProcess;
        });

        await expect(openDownloadLocation(mediaPath)).resolves.toEqual({
            opened: true,
            directoryPath: path.dirname(mediaPath)
        });
        expect(spawn).toHaveBeenCalledWith('explorer.exe', ['/select,', mediaPath], {
            detached: true,
            shell: false,
            stdio: 'ignore',
            windowsHide: false
        });
    });
});
