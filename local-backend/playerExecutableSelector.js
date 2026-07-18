const path = require('path');
const { execFile } = require('child_process');

const POWERSHELL_DIALOG_SCRIPT = [
    '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
    '$dialog.Title = "Choose video player executable"',
    '$dialog.Filter = "Applications (*.exe)|*.exe"',
    '$dialog.CheckFileExists = $true',
    '$dialog.Multiselect = $false',
    'if ($env:CUSTOM_STREMIO_PLAYER_INITIAL_DIRECTORY) { $dialog.InitialDirectory = $env:CUSTOM_STREMIO_PLAYER_INITIAL_DIRECTORY }',
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.FileName) }'
].join('; ');

class PlayerExecutableSelectorError extends Error {
    constructor(code, message, cause = null) {
        super(message);
        this.name = 'PlayerExecutableSelectorError';
        this.code = code;
        this.cause = cause;
    }
}

const getInitialDirectory = (currentExecutablePath) => {
    if (typeof currentExecutablePath !== 'string') {
        return '';
    }
    if (path.win32.isAbsolute(currentExecutablePath)) {
        return path.win32.dirname(currentExecutablePath);
    }
    return path.isAbsolute(currentExecutablePath) ? path.dirname(currentExecutablePath) : '';
};

const selectPlayerExecutable = ({
    currentExecutablePath = null,
    platform = process.platform,
    execFileImpl = execFile
} = {}) => {
    if (platform !== 'win32') {
        return Promise.reject(new PlayerExecutableSelectorError(
            'PLAYER_SELECTOR_UNSUPPORTED',
            'The native player selector is currently available only on Windows.'
        ));
    }

    return new Promise((resolve, reject) => {
        execFileImpl('powershell.exe', [
            '-NoLogo',
            '-NoProfile',
            '-STA',
            '-Command',
            POWERSHELL_DIALOG_SCRIPT
        ], {
            windowsHide: false,
            maxBuffer: 64 * 1024,
            env: {
                ...process.env,
                CUSTOM_STREMIO_PLAYER_INITIAL_DIRECTORY: getInitialDirectory(currentExecutablePath)
            }
        }, (error, stdout) => {
            if (error) {
                reject(new PlayerExecutableSelectorError(
                    'PLAYER_SELECTOR_FAILED',
                    `Could not open the Windows player selector: ${error.message || 'unknown error'}`,
                    error
                ));
                return;
            }

            const selectedPath = typeof stdout === 'string' ? stdout.replace(/^\uFEFF/, '').trim() : '';
            resolve(selectedPath || null);
        });
    });
};

module.exports = {
    POWERSHELL_DIALOG_SCRIPT,
    PlayerExecutableSelectorError,
    getInitialDirectory,
    selectPlayerExecutable
};
