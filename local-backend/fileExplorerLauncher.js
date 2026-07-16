const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class FileExplorerLaunchError extends Error {
    constructor(code, message, cause = null) {
        super(message);
        this.name = 'FileExplorerLaunchError';
        this.code = code;
        this.cause = cause;
    }
}

const getExplorerTarget = async (localPath) => {
    if (typeof localPath !== 'string' || localPath.length === 0 || !path.isAbsolute(localPath)) {
        throw new FileExplorerLaunchError('DOWNLOAD_PATH_INVALID', 'The download does not have a valid absolute local path.');
    }

    const directoryPath = path.dirname(localPath);
    try {
        const directoryStats = await fs.promises.stat(directoryPath);
        if (!directoryStats.isDirectory()) {
            throw new FileExplorerLaunchError('DOWNLOAD_DIRECTORY_NOT_FOUND', `The download directory was not found at ${directoryPath}.`);
        }
    } catch (error) {
        if (error instanceof FileExplorerLaunchError) {
            throw error;
        }
        throw new FileExplorerLaunchError('DOWNLOAD_DIRECTORY_NOT_FOUND', `The download directory was not found at ${directoryPath}.`, error);
    }

    try {
        const fileStats = await fs.promises.stat(localPath);
        if (fileStats.isFile()) {
            return {
                directoryPath,
                // Keep Explorer's switch separate so Node can quote paths with
                // spaces without wrapping the switch itself in those quotes.
                arguments: ['/select,', localPath]
            };
        }
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            throw new FileExplorerLaunchError('DOWNLOAD_PATH_UNAVAILABLE', `The download location could not be inspected: ${localPath}.`, error);
        }
    }

    return {
        directoryPath,
        arguments: [directoryPath]
    };
};

const spawnExplorer = (arguments_) => {
    return new Promise((resolve, reject) => {
        const childProcess = spawn('explorer.exe', arguments_, {
            detached: true,
            shell: false,
            stdio: 'ignore',
            windowsHide: false
        });

        childProcess.once('error', (error) => {
            reject(new FileExplorerLaunchError(
                'FILE_EXPLORER_LAUNCH_FAILED',
                `Could not open File Explorer: ${error.message || 'Unknown process error'}`,
                error
            ));
        });
        childProcess.once('spawn', () => {
            childProcess.unref();
            resolve();
        });
    });
};

const openDownloadLocation = async (localPath) => {
    const target = await getExplorerTarget(localPath);
    await spawnExplorer(target.arguments);
    return {
        opened: true,
        directoryPath: target.directoryPath
    };
};

module.exports = {
    FileExplorerLaunchError,
    getExplorerTarget,
    openDownloadLocation
};
