const path = require('path');
const { getDefaultDataDirectory } = require('../local-backend/dataDirectory');

// Resolution is pure: the launcher will create/set these paths before Electron is ready.
const getDesktopDataPaths = (options) => {
    const backendData = getDefaultDataDirectory(options);
    const userData = path.join(backendData, 'desktop-profile');

    return {
        backendData,
        userData,
        sessionData: path.join(userData, 'session'),
        logs: path.join(backendData, 'logs', 'desktop'),
        updateBackups: path.join(backendData, 'release-backups')
    };
};

module.exports = { getDesktopDataPaths };
