const os = require('os');
const path = require('path');

const DATA_DIR_ENV = 'CUSTOM_STREMIO_DATA_DIR';
const WINDOWS_DATA_DIRECTORY = 'Custom Stremio';

// Keep the existing backend location independent of app version and install path.
const getDefaultDataDirectory = ({ env = process.env, homeDirectory = os.homedir() } = {}) => {
    if (env[DATA_DIR_ENV]) {
        return path.resolve(env[DATA_DIR_ENV]);
    }

    if (env.LOCALAPPDATA) {
        return path.join(env.LOCALAPPDATA, WINDOWS_DATA_DIRECTORY);
    }

    return path.join(homeDirectory, '.custom-stremio');
};

module.exports = {
    DATA_DIR_ENV,
    WINDOWS_DATA_DIRECTORY,
    getDefaultDataDirectory
};
