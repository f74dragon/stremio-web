/* global jest, describe, beforeEach, afterEach, test, expect */

const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');

jest.mock('child_process', () => ({
    spawn: jest.fn()
}));

const { spawn } = require('child_process');
const { PLAYER_PATH_ENV, launchMediaFile } = require('../local-backend/playerLauncher');

describe('playerLauncher', () => {
    let tempDirectory;
    let playerPath;
    let mediaPath;
    let originalPlayerPath;

    beforeEach(() => {
        tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-stremio-player-'));
        playerPath = path.join(tempDirectory, 'player.exe');
        mediaPath = path.join(tempDirectory, 'video.mkv');
        fs.writeFileSync(playerPath, 'test player');
        fs.writeFileSync(mediaPath, 'test media');
        originalPlayerPath = process.env[PLAYER_PATH_ENV];
        delete process.env[PLAYER_PATH_ENV];
        spawn.mockReset();
    });

    afterEach(() => {
        if (originalPlayerPath === undefined) {
            delete process.env[PLAYER_PATH_ENV];
        } else {
            process.env[PLAYER_PATH_ENV] = originalPlayerPath;
        }
        fs.rmSync(tempDirectory, { recursive: true, force: true });
    });

    test('requires an explicitly configured player path', async () => {
        await expect(launchMediaFile(mediaPath)).rejects.toMatchObject({
            code: 'PLAYER_NOT_CONFIGURED'
        });
        expect(spawn).not.toHaveBeenCalled();
    });

    test('rejects a missing media file before launching', async () => {
        process.env[PLAYER_PATH_ENV] = playerPath;

        await expect(launchMediaFile(path.join(tempDirectory, 'missing.mkv'))).rejects.toMatchObject({
            code: 'MEDIA_FILE_NOT_FOUND'
        });
        expect(spawn).not.toHaveBeenCalled();
    });

    test('launches the configured player without a shell', async () => {
        const childProcess = new EventEmitter();
        childProcess.unref = jest.fn();
        spawn.mockImplementation(() => {
            process.nextTick(() => childProcess.emit('spawn'));
            return childProcess;
        });
        process.env[PLAYER_PATH_ENV] = `  ${playerPath}  `;

        await expect(launchMediaFile(mediaPath)).resolves.toEqual({
            launched: true,
            localPath: mediaPath
        });
        expect(spawn).toHaveBeenCalledWith(playerPath, [mediaPath], {
            detached: true,
            shell: false,
            stdio: 'ignore',
            windowsHide: false
        });
        expect(childProcess.unref).toHaveBeenCalledTimes(1);
    });
});
