/* global jest, describe, test, expect */

const {
    getInitialDirectory,
    selectPlayerExecutable
} = require('../local-backend/playerExecutableSelector');

describe('playerExecutableSelector', () => {
    test('opens a native PowerShell file dialog and returns the selected executable', async () => {
        const execFileImpl = jest.fn((executable, args, options, callback) => {
            callback(null, '\uFEFFC:\\Program Files\\MPC-HC\\mpc-hc64.exe\r\n');
        });

        await expect(selectPlayerExecutable({
            currentExecutablePath: 'C:\\Players\\old-player.exe',
            platform: 'win32',
            execFileImpl
        })).resolves.toBe('C:\\Program Files\\MPC-HC\\mpc-hc64.exe');
        expect(execFileImpl).toHaveBeenCalledWith(
            'powershell.exe',
            expect.arrayContaining(['-STA', '-Command']),
            expect.objectContaining({
                windowsHide: false,
                env: expect.objectContaining({ CUSTOM_STREMIO_PLAYER_INITIAL_DIRECTORY: 'C:\\Players' })
            }),
            expect.any(Function)
        );
    });

    test('returns null when the user cancels the dialog', async () => {
        const execFileImpl = jest.fn((executable, args, options, callback) => callback(null, ''));
        await expect(selectPlayerExecutable({ platform: 'win32', execFileImpl })).resolves.toBeNull();
    });

    test('reports unsupported platforms and dialog launch errors', async () => {
        await expect(selectPlayerExecutable({ platform: 'linux' })).rejects.toMatchObject({
            code: 'PLAYER_SELECTOR_UNSUPPORTED'
        });
        const execFileImpl = jest.fn((executable, args, options, callback) => callback(new Error('PowerShell unavailable')));
        await expect(selectPlayerExecutable({ platform: 'win32', execFileImpl })).rejects.toMatchObject({
            code: 'PLAYER_SELECTOR_FAILED'
        });
    });

    test('derives the initial folder without interpreting it as PowerShell source', () => {
        expect(getInitialDirectory('C:\\Program Files\\MPC-HC\\mpc-hc64.exe')).toBe('C:\\Program Files\\MPC-HC');
        expect(getInitialDirectory('relative.exe')).toBe('');
    });
});
