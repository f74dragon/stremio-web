const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PLAYER_PATH_ENV = 'CUSTOM_STREMIO_PLAYER_PATH';

class PlayerLaunchError extends Error {
    constructor(code, message, cause = null) {
        super(message);
        this.name = 'PlayerLaunchError';
        this.code = code;
        this.cause = cause;
    }
}

const getConfiguredPlayerPath = () => {
    const configuredPath = process.env[PLAYER_PATH_ENV];
    return typeof configuredPath === 'string' && configuredPath.trim().length > 0 ? configuredPath.trim() : null;
};

const requireRegularFile = async (filePath, options) => {
    if (typeof filePath !== 'string' || filePath.length === 0 || !path.isAbsolute(filePath)) {
        throw new PlayerLaunchError(options.invalidCode, options.invalidMessage);
    }

    let fileStats;
    try {
        fileStats = await fs.promises.stat(filePath);
    } catch (error) {
        throw new PlayerLaunchError(options.missingCode, options.missingMessage, error);
    }

    if (!fileStats.isFile()) {
        throw new PlayerLaunchError(options.missingCode, options.missingMessage);
    }
};

const spawnPlayer = (playerPath, localPath) => {
    return new Promise((resolve, reject) => {
        const childProcess = spawn(playerPath, [localPath], {
            detached: true,
            shell: false,
            stdio: 'ignore',
            windowsHide: false
        });

        childProcess.once('error', (error) => {
            reject(new PlayerLaunchError(
                'PLAYER_LAUNCH_FAILED',
                `Could not launch the configured media player: ${error.message || 'Unknown process error'}`,
                error
            ));
        });
        childProcess.once('spawn', () => {
            childProcess.unref();
            resolve();
        });
    });
};

const launchMediaFile = async (localPath) => {
    const playerPath = getConfiguredPlayerPath();
    if (!playerPath) {
        throw new PlayerLaunchError(
            'PLAYER_NOT_CONFIGURED',
            `Media player is not configured. Set ${PLAYER_PATH_ENV} before starting the local backend.`
        );
    }

    await requireRegularFile(playerPath, {
        invalidCode: 'PLAYER_PATH_INVALID',
        invalidMessage: `${PLAYER_PATH_ENV} must contain an absolute path to the player executable.`,
        missingCode: 'PLAYER_NOT_FOUND',
        missingMessage: `Configured media player was not found at ${playerPath}.`
    });
    await requireRegularFile(localPath, {
        invalidCode: 'MEDIA_PATH_INVALID',
        invalidMessage: 'The completed download does not have a valid absolute local path.',
        missingCode: 'MEDIA_FILE_NOT_FOUND',
        missingMessage: `The downloaded file was not found at ${localPath}.`
    });
    await spawnPlayer(playerPath, localPath);

    return {
        launched: true,
        localPath
    };
};

module.exports = {
    PLAYER_PATH_ENV,
    PlayerLaunchError,
    getConfiguredPlayerPath,
    launchMediaFile
};
